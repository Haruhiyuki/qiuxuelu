// 文章互动状态读取（非 Server Action）：点赞/收藏计数 + 当前用户是否已点赞/收藏。
import { type Database, docReactions } from '@harublog/db';
import { and, count, eq } from 'drizzle-orm';

export interface ReactionState {
  likeCount: number;
  liked: boolean;
  bookmarked: boolean;
}

export async function getReactionState(
  db: Pick<Database, 'select'>,
  docId: string,
  userId: string | null,
): Promise<ReactionState> {
  const likeRows = await db
    .select({ n: count() })
    .from(docReactions)
    .where(and(eq(docReactions.documentId, docId), eq(docReactions.kind, 'like')));
  const likeCount = Number(likeRows[0]?.n ?? 0);
  if (userId === null) {
    return { likeCount, liked: false, bookmarked: false };
  }
  const mine = await db
    .select({ kind: docReactions.kind })
    .from(docReactions)
    .where(and(eq(docReactions.documentId, docId), eq(docReactions.userId, userId)));
  return {
    likeCount,
    liked: mine.some((r) => r.kind === 'like'),
    bookmarked: mine.some((r) => r.kind === 'bookmark'),
  };
}
