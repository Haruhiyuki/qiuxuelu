// @harublog/search —— Meilisearch 块级索引（架构 §8）。
// 索引单元 = 已发布文章的「块」：命中直达段落锚点 #b-{blockId}，这是长文站的体验差异点。
// Meilisearch 不是真相源，索引可随时从 Postgres 全量重建；故无需备份、无 HA 焦虑。
import { type Index, Meilisearch } from 'meilisearch';

/** 块级搜索文档：id = `${docId}_${blockId}`（Meilisearch 主键仅允许 [A-Za-z0-9_-]，故用下划线连接两个 uuid）。 */
export interface BlockSearchDoc {
  id: string;
  docId: string;
  slug: string;
  title: string;
  sectionSlug: string;
  sectionName: string;
  blockId: string;
  position: number;
  text: string;
  /** 发布时间（epoch 毫秒）：可排序。 */
  publishedAt: number;
}

export const BLOCKS_INDEX = 'blocks';

let client: Meilisearch | undefined;

/** 惰性客户端：env 在使用时读取，模块加载零副作用（构建期无 Meili 不报错）。 */
export function getSearchClient(): Meilisearch {
  if (client === undefined) {
    const host = process.env.MEILISEARCH_HOST ?? 'http://localhost:7700';
    const apiKey = process.env.MEILI_MASTER_KEY;
    client = new Meilisearch({ host, apiKey });
  }
  return client;
}

function blocksIndex(): Index<BlockSearchDoc> {
  return getSearchClient().index<BlockSearchDoc>(BLOCKS_INDEX);
}

/**
 * 确保 blocks 索引存在并配置好属性。worker 启动时调用一次（幂等）。
 * 中文分词由 Meilisearch 内置 charabia（含 jieba）开箱处理，无需额外配置。
 */
export async function ensureBlocksIndex(): Promise<void> {
  const ms = getSearchClient();
  await ms.createIndex(BLOCKS_INDEX, { primaryKey: 'id' }).catch(() => {
    // 已存在即忽略（createIndex 对已存在索引会返回任务失败，不影响后续设置）
  });
  const index = blocksIndex();
  await index.updateSettings({
    searchableAttributes: ['title', 'text'],
    filterableAttributes: ['docId', 'sectionSlug'],
    sortableAttributes: ['publishedAt', 'position'],
    // 标题权重高于正文：搜词命中标题的块排前
    rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'],
  });
}

/** 用一篇文章当前已发布的全部块覆盖其索引（先删后增，避免残留旧块）。 */
export async function indexDocumentBlocks(docId: string, docs: BlockSearchDoc[]): Promise<void> {
  const index = blocksIndex();
  await index.deleteDocuments({ filter: `docId = "${docId}"` });
  if (docs.length > 0) {
    await index.addDocuments(docs);
  }
}

/** 文章下线 / 删除时移除其全部块索引。 */
export async function removeDocument(docId: string): Promise<void> {
  await blocksIndex().deleteDocuments({ filter: `docId = "${docId}"` });
}

export interface SearchHit {
  docId: string;
  slug: string;
  title: string;
  sectionName: string;
  blockId: string;
  text: string;
  /** 高亮片段（命中词包裹 <mark>），用于结果摘要展示。 */
  snippet: string;
}

export interface SearchResult {
  hits: SearchHit[];
  estimatedTotal: number;
  query: string;
}

/** 块级搜索：返回命中块（含高亮片段），调用方按 docId 分组展示并深链到段落。 */
export async function searchBlocks(query: string, limit = 30): Promise<SearchResult> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return { hits: [], estimatedTotal: 0, query: '' };
  }
  const res = await blocksIndex().search(trimmed, {
    limit,
    attributesToHighlight: ['text'],
    highlightPreTag: '<mark>',
    highlightPostTag: '</mark>',
    attributesToCrop: ['text'],
    cropLength: 40,
  });
  const hits: SearchHit[] = res.hits.map((h) => ({
    docId: h.docId,
    slug: h.slug,
    title: h.title,
    sectionName: h.sectionName,
    blockId: h.blockId,
    text: h.text,
    snippet: (h as { _formatted?: { text?: string } })._formatted?.text ?? h.text.slice(0, 80),
  }));
  return { hits, estimatedTotal: res.estimatedTotalHits ?? hits.length, query: trimmed };
}
