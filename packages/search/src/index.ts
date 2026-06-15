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
  /** 作者名（可搜）：同一文档全部块写相同值。 */
  authorName: string;
  /** 标签（可搜 + 可过滤/分面）：同一文档全部块写相同数组。 */
  tags: string[];
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
    // 可搜字段按权重降序：标题 > 作者 > 标签 > 正文（attribute 排序规则据此给前者更高权重）
    searchableAttributes: ['title', 'authorName', 'tags', 'text'],
    filterableAttributes: ['docId', 'sectionSlug', 'tags'],
    sortableAttributes: ['publishedAt', 'position'],
    // 一篇文章只出一个最佳命中块：避免长文同词多段刷屏，结果与翻页都按「文章」为单位
    distinctAttribute: 'docId',
    rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'],
  });
  // 远期语义检索（架构 §8 M5）：配置了 embedder 才开启向量化，Meilisearch 索引期自动算 embedding；
  // 未配置则保持纯关键词。生产可用 bge-m3（Ollama 源）做中文混合召回。
  const embedder = embedderConfig();
  if (embedder !== null) {
    // embedder 形状随 source 动态（ollama/openAi），用 Parameters 取 SDK 期望类型做一次定向 cast
    await index.updateSettings({ embedders: { semantic: embedder } } as unknown as Parameters<
      typeof index.updateSettings
    >[0]);
  }
}

/** 可插拔 embedder 配置（env 驱动）；未配置返回 null（纯关键词）。 */
function embedderConfig(): Record<string, unknown> | null {
  const source = process.env.MEILI_EMBEDDER_SOURCE;
  if (source !== 'ollama' && source !== 'openAi') {
    return null;
  }
  const model = process.env.MEILI_EMBEDDER_MODEL ?? 'bge-m3';
  const documentTemplate = '{{doc.title}} {{doc.text}}';
  const dims = process.env.MEILI_EMBEDDER_DIMENSIONS;
  const base: Record<string, unknown> = { source, model, documentTemplate };
  if (dims !== undefined && dims.length > 0) {
    base.dimensions = Number(dims);
  }
  if (source === 'ollama') {
    base.url = process.env.MEILI_EMBEDDER_URL ?? 'http://localhost:11434/api/embeddings';
  } else {
    base.apiKey = process.env.MEILI_EMBEDDER_API_KEY ?? '';
  }
  return base;
}

/** 是否已启用语义/混合检索（配置了 embedder）。 */
export function semanticSearchEnabled(): boolean {
  return embedderConfig() !== null;
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
  sectionSlug: string;
  blockId: string;
  text: string;
  authorName: string;
  tags: string[];
  /** 高亮片段（命中词包裹 <mark>），用于结果摘要展示。 */
  snippet: string;
}

export interface SearchResult {
  hits: SearchHit[];
  estimatedTotal: number;
  query: string;
  /** 分面计数：{ 属性名: { 取值: 命中数 } }，仅当请求 facets 时返回。 */
  facetDistribution?: Record<string, Record<string, number>>;
}

export interface SearchOptions {
  limit?: number;
  /** 翻页偏移（块命中级）。 */
  offset?: number;
  /** 语义占比 0–1（仅在配置了 embedder 时生效）；0=纯关键词、1=纯语义，默认 0.5 混合。 */
  semanticRatio?: number;
  /** 限定板块（按 sectionSlug 过滤；filterableAttributes 已含）。 */
  sectionSlug?: string;
  /** 限定标签（按 tags 过滤；filterableAttributes 已含）。 */
  tag?: string;
  /** 排序：relevance=按相关度（默认）；newest=按发布时间倒序。 */
  sort?: 'relevance' | 'newest';
  /** 需要的分面统计属性（如 ['sectionSlug']）；返回 facetDistribution。 */
  facets?: string[];
}

/** 块级搜索：返回命中块（含高亮片段），调用方按 docId 分组展示并深链到段落。
 *  配置了 embedder 时自动走 hybrid（关键词 + 向量）混合召回。 */
export async function searchBlocks(
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return { hits: [], estimatedTotal: 0, query: '' };
  }
  const limit = options.limit ?? 30;
  const params: Record<string, unknown> = {
    limit,
    offset: options.offset ?? 0,
    attributesToHighlight: ['text'],
    highlightPreTag: '<mark>',
    highlightPostTag: '</mark>',
    attributesToCrop: ['text'],
    cropLength: 40,
  };
  // 过滤子句（多条 AND）：板块、标签。值剔除引号以杜绝 filter 注入
  const filters: string[] = [];
  if (options.sectionSlug !== undefined && options.sectionSlug.length > 0) {
    filters.push(`sectionSlug = "${options.sectionSlug.replaceAll('"', '')}"`);
  }
  if (options.tag !== undefined && options.tag.length > 0) {
    filters.push(`tags = "${options.tag.replaceAll('"', '')}"`);
  }
  if (filters.length > 0) {
    params.filter = filters;
  }
  if (options.sort === 'newest') {
    params.sort = ['publishedAt:desc'];
  }
  if (options.facets !== undefined && options.facets.length > 0) {
    params.facets = options.facets;
  }
  if (semanticSearchEnabled()) {
    params.hybrid = { embedder: 'semantic', semanticRatio: options.semanticRatio ?? 0.5 };
  }
  const index = blocksIndex();
  const res = await index.search(trimmed, params as Parameters<typeof index.search>[1]);
  const hits: SearchHit[] = res.hits.map((h) => ({
    docId: h.docId,
    slug: h.slug,
    title: h.title,
    sectionName: h.sectionName,
    sectionSlug: h.sectionSlug,
    blockId: h.blockId,
    text: h.text,
    authorName: h.authorName ?? '',
    tags: Array.isArray(h.tags) ? h.tags : [],
    snippet: (h as { _formatted?: { text?: string } })._formatted?.text ?? h.text.slice(0, 80),
  }));
  return {
    hits,
    estimatedTotal: res.estimatedTotalHits ?? hits.length,
    query: trimmed,
    facetDistribution: (res as { facetDistribution?: Record<string, Record<string, number>> })
      .facetDistribution,
  };
}
