'use server';

// ⌘K 速搜：客户端防抖调用，返回「按文档分组」的精简命中（每组至多 3 段、至多 6 篇）。
// 只读公开已发布内容，无需鉴权；空查询直接返回空。
import { runSearch, type SearchGroup } from '@/server/search';

export interface QuickSearchResult {
  groups: SearchGroup[];
  /** 命中段落估计总数（用于「查看全部结果」提示）。 */
  total: number;
  failed: boolean;
}

const MAX_GROUPS = 6;

export async function quickSearch(query: string): Promise<QuickSearchResult> {
  const r = await runSearch({ query, page: 1, pageSize: 18, hitsPerGroup: 3 });
  return { groups: r.groups.slice(0, MAX_GROUPS), total: r.total, failed: r.failed };
}
