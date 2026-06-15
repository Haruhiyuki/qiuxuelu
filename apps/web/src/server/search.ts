// 站内搜索读路径：在 @harublog/search（Meilisearch 块级索引）之上做「按文档去重 + 板块/标签分面」。
// 全文页与 ⌘K 速搜共用 runSearch，保证去重/降级语义一致。Meilisearch 非真相源——查询失败降级不崩页。
// 索引已设 distinctAttribute=docId：一篇文章只回一个最佳命中块（不再同文多段刷屏）。

import { getDb, sections } from '@harublog/db';
import { searchBlocks } from '@harublog/search';

export interface SearchHitItem {
  blockId: string;
  /** 高亮片段（含受控 <mark>），由 SearchSnippet 安全重建为 React 文本。 */
  snippet: string;
}

/** 一篇命中文档（去重后通常仅含 1 个最佳命中块，直达 #b-{blockId}）。 */
export interface SearchGroup {
  docId: string;
  slug: string;
  title: string;
  sectionName: string;
  sectionSlug: string;
  authorName: string;
  tags: string[];
  hits: SearchHitItem[];
}

/** 板块分面（针对当前查询、跨全部板块的命中数），供结果页筛选。 */
export interface SearchFacet {
  slug: string;
  name: string;
  count: number;
}

/** 标签分面：取值即标签名。 */
export interface TagFacet {
  name: string;
  count: number;
}

export type SearchSort = 'relevance' | 'newest';

export interface RunSearchArgs {
  query: string;
  page?: number;
  pageSize?: number;
  /** 限定板块；null=全部。 */
  sectionSlug?: string | null;
  /** 限定标签；null=全部。 */
  tag?: string | null;
  sort?: SearchSort;
  /** 是否返回板块/标签分面计数（结果页用，速搜不用）。 */
  withFacets?: boolean;
  /** 每组最多展示几条段落（去重后一般为 1，仍保留兜底）。 */
  hitsPerGroup?: number;
}

export interface RunSearchResult {
  groups: SearchGroup[];
  /** 命中文章估计总数（distinct docId，用于翻页与计数）。 */
  total: number;
  sectionFacets: SearchFacet[];
  tagFacets: TagFacet[];
  /** Meilisearch 不可用时为 true：调用方降级提示。 */
  failed: boolean;
}

/** 标签分面最多展示个数（避免长尾刷屏）。 */
const MAX_TAG_FACETS = 12;

/** sectionSlug → 板块名（结果页分面展示用）。板块表很小，直查即可。 */
async function sectionNameMap(): Promise<Map<string, string>> {
  const rows = await getDb().select({ slug: sections.slug, name: sections.name }).from(sections);
  return new Map(rows.map((r) => [r.slug, r.name]));
}

export async function runSearch(args: RunSearchArgs): Promise<RunSearchResult> {
  const empty: RunSearchResult = {
    groups: [],
    total: 0,
    sectionFacets: [],
    tagFacets: [],
    failed: false,
  };
  const query = args.query.trim();
  if (query.length === 0) {
    return empty;
  }
  const page = Math.max(1, args.page ?? 1);
  const pageSize = args.pageSize ?? 20;
  const sort: SearchSort = args.sort ?? 'relevance';
  const sectionSlug = args.sectionSlug ?? undefined;
  const tag = args.tag ?? undefined;

  try {
    // 结果（带过滤/排序/翻页）与分面（不带板块/标签过滤，按查询给全集计数，便于切换）并行
    const [main, facetRes] = await Promise.all([
      searchBlocks(query, {
        limit: pageSize,
        offset: (page - 1) * pageSize,
        sectionSlug,
        tag,
        sort,
      }),
      args.withFacets
        ? searchBlocks(query, { limit: 0, facets: ['sectionSlug', 'tags'] })
        : Promise.resolve(null),
    ]);

    const byDoc = new Map<string, SearchGroup>();
    for (const hit of main.hits) {
      const g = byDoc.get(hit.docId) ?? {
        docId: hit.docId,
        slug: hit.slug,
        title: hit.title,
        sectionName: hit.sectionName,
        sectionSlug: hit.sectionSlug,
        authorName: hit.authorName,
        tags: hit.tags,
        hits: [],
      };
      if (args.hitsPerGroup === undefined || g.hits.length < args.hitsPerGroup) {
        g.hits.push({ blockId: hit.blockId, snippet: hit.snippet });
      }
      byDoc.set(hit.docId, g);
    }
    const groups = [...byDoc.values()];

    let sectionFacets: SearchFacet[] = [];
    let tagFacets: TagFacet[] = [];
    const secDist = facetRes?.facetDistribution?.sectionSlug;
    if (secDist !== undefined) {
      const nameBySlug = await sectionNameMap();
      sectionFacets = Object.entries(secDist)
        .map(([slug, count]) => ({ slug, name: nameBySlug.get(slug) ?? slug, count }))
        .filter((f) => f.count > 0)
        .sort((a, b) => b.count - a.count);
    }
    const tagDist = facetRes?.facetDistribution?.tags;
    if (tagDist !== undefined) {
      tagFacets = Object.entries(tagDist)
        .map(([name, count]) => ({ name, count }))
        .filter((f) => f.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, MAX_TAG_FACETS);
    }

    return { groups, total: main.estimatedTotal, sectionFacets, tagFacets, failed: false };
  } catch {
    // 搜索服务不可用：降级，不崩页（Meilisearch 非真相源）
    return { ...empty, failed: true };
  }
}
