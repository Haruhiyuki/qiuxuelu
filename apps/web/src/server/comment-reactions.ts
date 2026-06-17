// 评论赞踩状态批量读取（非 Server Action）：给定评论 id 一次查出每条的赞/踩计数与当前用户投票方向。
import { commentReactions, type Database } from '@harublog/db';
import { and, count, eq, inArray } from 'drizzle-orm';
import type { VoteDirection } from '@/server/reactions';

export interface CommentReactionState {
  likeCount: number;
  dislikeCount: number;
  /** 当前用户对该评论的投票方向；未登录或未投为 null */
  myVote: VoteDirection | null;
}

export async function getCommentReactions(
  db: Pick<Database, 'select'>,
  commentIds: string[],
  userId: string | null,
): Promise<Map<string, CommentReactionState>> {
  const map = new Map<string, CommentReactionState>();
  if (commentIds.length === 0) {
    return map;
  }
  for (const id of commentIds) {
    map.set(id, { likeCount: 0, dislikeCount: 0, myVote: null });
  }

  const countRows = await db
    .select({ commentId: commentReactions.commentId, kind: commentReactions.kind, n: count() })
    .from(commentReactions)
    .where(inArray(commentReactions.commentId, commentIds))
    .groupBy(commentReactions.commentId, commentReactions.kind);
  for (const r of countRows) {
    const e = map.get(r.commentId);
    if (e === undefined) {
      continue;
    }
    if (r.kind === 'like') {
      e.likeCount = Number(r.n);
    } else if (r.kind === 'dislike') {
      e.dislikeCount = Number(r.n);
    }
  }

  if (userId !== null) {
    const mine = await db
      .select({ commentId: commentReactions.commentId, kind: commentReactions.kind })
      .from(commentReactions)
      .where(
        and(inArray(commentReactions.commentId, commentIds), eq(commentReactions.userId, userId)),
      );
    for (const r of mine) {
      const e = map.get(r.commentId);
      if (e !== undefined && (r.kind === 'like' || r.kind === 'dislike')) {
        e.myVote = r.kind;
      }
    }
  }
  return map;
}
