// 公示评议读路径（非 Server Action）：聚合 avg/count 与评论列表，供公示页与权限者后台引用。
import { collabReviews, getDb, user as userTable } from '@harublog/db';
import { and, eq } from 'drizzle-orm';

export type ReviewTarget = 'feedback' | 'suggestion' | 'revision';

export interface ReviewSummary {
  avg: number;
  count: number;
}

/** 一批协作项的评议聚合（avg + count）。 */
export async function summarizeReviews(
  targetType: ReviewTarget,
  targetIds: string[],
): Promise<Map<string, ReviewSummary>> {
  const out = new Map<string, ReviewSummary>();
  if (targetIds.length === 0) {
    return out;
  }
  const wanted = new Set(targetIds);
  const rows = await getDb()
    .select({ targetId: collabReviews.targetId, rating: collabReviews.rating })
    .from(collabReviews)
    .where(eq(collabReviews.targetType, targetType));
  const acc = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    if (!wanted.has(r.targetId)) {
      continue;
    }
    const a = acc.get(r.targetId) ?? { sum: 0, n: 0 };
    a.sum += r.rating;
    a.n += 1;
    acc.set(r.targetId, a);
  }
  for (const [id, a] of acc) {
    out.set(id, { avg: a.n === 0 ? 0 : a.sum / a.n, count: a.n });
  }
  return out;
}

export interface ReviewRow {
  authorName: string | null;
  rating: number;
  text: string | null;
  createdAt: Date;
}

export interface ItemReviews {
  summary: ReviewSummary;
  reviews: ReviewRow[];
}

/** 一次性取某文档下全部协作项的评议，按 targetId 分组（公示页用，省 N 次查询）。 */
export async function loadDocReviews(documentId: string): Promise<Map<string, ItemReviews>> {
  const rows = await getDb()
    .select({
      targetId: collabReviews.targetId,
      rating: collabReviews.rating,
      body: collabReviews.body,
      createdAt: collabReviews.createdAt,
      authorName: userTable.name,
    })
    .from(collabReviews)
    .leftJoin(userTable, eq(userTable.id, collabReviews.authorId))
    .where(eq(collabReviews.documentId, documentId));
  const out = new Map<string, ItemReviews>();
  for (const r of rows) {
    const entry = out.get(r.targetId) ?? { summary: { avg: 0, count: 0 }, reviews: [] };
    entry.reviews.push({
      authorName: r.authorName,
      rating: r.rating,
      text:
        typeof (r.body as { text?: unknown })?.text === 'string'
          ? (r.body as { text: string }).text
          : null,
      createdAt: r.createdAt,
    });
    out.set(r.targetId, entry);
  }
  for (const entry of out.values()) {
    const n = entry.reviews.length;
    const sum = entry.reviews.reduce((s, x) => s + x.rating, 0);
    entry.summary = { avg: n === 0 ? 0 : sum / n, count: n };
  }
  return out;
}

/** 某协作项的全部评议（打分 + 评论），公示页展示用。 */
export async function listReviewsFor(
  targetType: ReviewTarget,
  targetId: string,
): Promise<ReviewRow[]> {
  const rows = await getDb()
    .select({
      rating: collabReviews.rating,
      body: collabReviews.body,
      createdAt: collabReviews.createdAt,
      authorName: userTable.name,
    })
    .from(collabReviews)
    .leftJoin(userTable, eq(userTable.id, collabReviews.authorId))
    .where(and(eq(collabReviews.targetType, targetType), eq(collabReviews.targetId, targetId)));
  return rows.map((r) => ({
    authorName: r.authorName,
    rating: r.rating,
    text:
      typeof (r.body as { text?: unknown })?.text === 'string'
        ? (r.body as { text: string }).text
        : null,
    createdAt: r.createdAt,
  }));
}
