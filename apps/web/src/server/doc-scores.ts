// 博客净分（赞 − 踩）批量聚合：列表页用，一次查出给定博客的分数表，避免逐条 N+1。
import type { Database } from '@harublog/db';
import { docReactions } from '@harublog/db';
import { inArray, sql } from 'drizzle-orm';

/** 给定博客 id，返回 id→净分（赞 +1 / 踩 −1，收藏不计）的映射；无反应的博客不在表中（视作 0）。 */
export async function loadDocScores(
  db: Pick<Database, 'select'>,
  docIds: string[],
): Promise<Map<string, number>> {
  if (docIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      docId: docReactions.documentId,
      score: sql<number>`sum(case when ${docReactions.kind} = 'like' then 1 when ${docReactions.kind} = 'dislike' then -1 else 0 end)::int`,
    })
    .from(docReactions)
    .where(inArray(docReactions.documentId, docIds))
    .groupBy(docReactions.documentId);
  return new Map(rows.map((r) => [r.docId, Number(r.score)]));
}
