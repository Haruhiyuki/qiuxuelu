// 站内搜索读路径：在 @harublog/search（Meilisearch 块级索引）之上做「按文档去重 + 板块分面」。
// 全文页与 ⌘K 速搜共用 runSearch，保证去重/降级语义一致。Meilisearch 非真相源——查询失败降级不崩页。
// 索引已设 distinctAttribute=docId：一篇文章只回一个最佳命中块（不再同文多段刷屏）。
// 作者/标签已并入可搜字段（自由文本即可命中），故无需单独的标签筛选 UI——保持简单。

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

export type SearchSort = 'relevance' | 'newest';

export interface RunSearchArgs {
  query: string;
  page?: number;
  pageSize?: number;
  /** 限定板块；null=全部。 */
  sectionSlug?: string | null;
  sort?: SearchSort;
  /** 是否返回板块分面计数（结果页用，速搜不用）。 */
  withFacets?: boolean;
  /** 每组最多展示几条段落（去重后一般为 1，仍保留兜底）。 */
  hitsPerGroup?: number;
}

export interface RunSearchResult {
  groups: SearchGroup[];
  /** 命中文章估计总数（distinct docId，用于翻页与计数）。 */
  total: number;
  sectionFacets: SearchFacet[];
  /** Meilisearch 不可用时为 true：调用方降级提示。 */
  failed: boolean;
}

/** sectionSlug → 板块名（结果页分面展示用）。板块表很小，直查即可。 */
async function sectionNameMap(): Promise<Map<string, string>> {
  const rows = await getDb().select({ slug: sections.slug, name: sections.name }).from(sections);
  return new Map(rows.map((r) => [r.slug, r.name]));
}

export async function runSearch(args: RunSearchArgs): Promise<RunSearchResult> {
  const empty: RunSearchResult = { groups: [], total: 0, sectionFacets: [], failed: false };
  const query = args.query.trim();
  if (query.length === 0) {
    return empty;
  }
  const page = Math.max(1, args.page ?? 1);
  const pageSize = args.pageSize ?? 20;
  const sort: SearchSort = args.sort ?? 'relevance';
  const sectionSlug = args.sectionSlug ?? undefined;

  try {
    // 结果（带板块过滤/排序/翻页）与板块分面（不带板块过滤，便于切换）并行
    const [main, facetRes] = await Promise.all([
      searchBlocks(query, { limit: pageSize, offset: (page - 1) * pageSize, sectionSlug, sort }),
      args.withFacets
        ? searchBlocks(query, { limit: 0, facets: ['sectionSlug'] })
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

    // 板块分面计数：Meilisearch 的 facetDistribution 计的是「命中块」数（distinctAttribute 不作用于分面），
    // 与去重后的「篇」数对不上（长文同词多段会虚高）。故先用一次 facets 查询拿到「有命中的板块集合」，
    // 再对每个板块各跑一次 limit:0 查询，用其 estimatedTotal（已按 docId 去重=命中文章数）作为分面数。
    let sectionFacets: SearchFacet[] = [];
    const secDist = facetRes?.facetDistribution?.sectionSlug;
    if (secDist !== undefined) {
      const slugs = Object.entries(secDist)
        .filter(([, c]) => c > 0)
        .map(([slug]) => slug);
      if (slugs.length > 0) {
        const nameBySlug = await sectionNameMap();
        const counted = await Promise.all(
          slugs.map((slug) =>
            searchBlocks(query, { sectionSlug: slug, limit: 0 }).then((r) => ({
              slug,
              name: nameBySlug.get(slug) ?? slug,
              count: r.estimatedTotal,
            })),
          ),
        );
        sectionFacets = counted.filter((f) => f.count > 0).sort((a, b) => b.count - a.count);
      }
    }

    return { groups, total: main.estimatedTotal, sectionFacets, failed: false };
  } catch {
    // 搜索服务不可用：降级，不崩页（Meilisearch 非真相源）
    return { ...empty, failed: true };
  }
}
