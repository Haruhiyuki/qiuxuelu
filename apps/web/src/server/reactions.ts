// 博客互动状态读取（非 Server Action）：赞/踩计数 + 当前用户的投票方向与收藏状态。
import { type Database, docReactions } from '@harublog/db';
import { and, count, eq, inArray } from 'drizzle-orm';

export type VoteDirection = 'like' | 'dislike';

export interface ReactionState {
  likeCount: number;
  dislikeCount: number;
  /** 当前用户的投票方向；未登录或未投为 null */
  myVote: VoteDirection | null;
  bookmarked: boolean;
}

export async function getReactionState(
  db: Pick<Database, 'select'>,
  docId: string,
  userId: string | null,
): Promise<ReactionState> {
  const countRows = await db
    .select({ kind: docReactions.kind, n: count() })
    .from(docReactions)
    .where(and(eq(docReactions.documentId, docId), inArray(docReactions.kind, ['like', 'dislike'])))
    .groupBy(docReactions.kind);
  let likeCount = 0;
  let dislikeCount = 0;
  for (const r of countRows) {
    if (r.kind === 'like') {
      likeCount = Number(r.n);
    } else if (r.kind === 'dislike') {
      dislikeCount = Number(r.n);
    }
  }
  if (userId === null) {
    return { likeCount, dislikeCount, myVote: null, bookmarked: false };
  }
  const mine = await db
    .select({ kind: docReactions.kind })
    .from(docReactions)
    .where(and(eq(docReactions.documentId, docId), eq(docReactions.userId, userId)));
  const myVote = mine.some((r) => r.kind === 'like')
    ? ('like' as const)
    : mine.some((r) => r.kind === 'dislike')
      ? ('dislike' as const)
      : null;
  return {
    likeCount,
    dislikeCount,
    myVote,
    bookmarked: mine.some((r) => r.kind === 'bookmark'),
  };
}
