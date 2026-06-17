'use server';

// 赞/踩/收藏：登录即可（轻量互动，非内容贡献，不过 consent 闸）。
// 投票切换式：点同向取消、点反向改票（事务内删反向再写本向，保证一人一票）。
import { commentReactions, docReactions, getDb } from '@harublog/db';
import { and, count, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';
import type { VoteDirection } from '@/server/reactions';

const uuid = z.uuid();

export interface VoteResult {
  /** 投票后的我方状态（null = 取消了投票） */
  myVote: VoteDirection | null;
  likeCount: number;
  dislikeCount: number;
}

export async function voteDoc(
  docId: string,
  direction: VoteDirection,
): Promise<ActionResult<VoteResult>> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: '请先登录' };
  }
  if (direction !== 'like' && direction !== 'dislike') {
    return { ok: false, error: '非法操作' };
  }
  if (!uuid.safeParse(docId).success) {
    return { ok: false, error: '文档参数非法' };
  }
  const db = getDb();
  const uid = session.user.id;
  const opposite: VoteDirection = direction === 'like' ? 'dislike' : 'like';

  const myVote = await db.transaction(async (tx) => {
    const mine = await tx
      .select({ kind: docReactions.kind })
      .from(docReactions)
      .where(
        and(
          eq(docReactions.userId, uid),
          eq(docReactions.documentId, docId),
          inArray(docReactions.kind, ['like', 'dislike']),
        ),
      );
    const hasSame = mine.some((r) => r.kind === direction);
    const hasOpposite = mine.some((r) => r.kind === opposite);
    if (hasOpposite) {
      await tx
        .delete(docReactions)
        .where(
          and(
            eq(docReactions.userId, uid),
            eq(docReactions.documentId, docId),
            eq(docReactions.kind, opposite),
          ),
        );
    }
    if (hasSame) {
      // 点同向 = 取消投票
      await tx
        .delete(docReactions)
        .where(
          and(
            eq(docReactions.userId, uid),
            eq(docReactions.documentId, docId),
            eq(docReactions.kind, direction),
          ),
        );
      return null;
    }
    await tx
      .insert(docReactions)
      .values({ userId: uid, documentId: docId, kind: direction })
      .onConflictDoNothing();
    return direction;
  });

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
  return { ok: true, data: { myVote, likeCount, dislikeCount } };
}

/** 评论赞/踩：登录即可（轻量互动）。切换式：点同向取消、点反向改票，事务内保证一人一票。 */
export async function voteComment(
  commentId: string,
  direction: VoteDirection,
): Promise<ActionResult<VoteResult>> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: '请先登录' };
  }
  if (direction !== 'like' && direction !== 'dislike') {
    return { ok: false, error: '非法操作' };
  }
  if (!uuid.safeParse(commentId).success) {
    return { ok: false, error: '评论参数非法' };
  }
  const db = getDb();
  const uid = session.user.id;
  const opposite: VoteDirection = direction === 'like' ? 'dislike' : 'like';

  const myVote = await db.transaction(async (tx) => {
    const mine = await tx
      .select({ kind: commentReactions.kind })
      .from(commentReactions)
      .where(and(eq(commentReactions.userId, uid), eq(commentReactions.commentId, commentId)));
    const hasSame = mine.some((r) => r.kind === direction);
    const hasOpposite = mine.some((r) => r.kind === opposite);
    if (hasOpposite) {
      await tx
        .delete(commentReactions)
        .where(
          and(
            eq(commentReactions.userId, uid),
            eq(commentReactions.commentId, commentId),
            eq(commentReactions.kind, opposite),
          ),
        );
    }
    if (hasSame) {
      await tx
        .delete(commentReactions)
        .where(
          and(
            eq(commentReactions.userId, uid),
            eq(commentReactions.commentId, commentId),
            eq(commentReactions.kind, direction),
          ),
        );
      return null;
    }
    await tx
      .insert(commentReactions)
      .values({ userId: uid, commentId, kind: direction })
      .onConflictDoNothing();
    return direction;
  });

  const countRows = await db
    .select({ kind: commentReactions.kind, n: count() })
    .from(commentReactions)
    .where(eq(commentReactions.commentId, commentId))
    .groupBy(commentReactions.kind);
  let likeCount = 0;
  let dislikeCount = 0;
  for (const r of countRows) {
    if (r.kind === 'like') {
      likeCount = Number(r.n);
    } else if (r.kind === 'dislike') {
      dislikeCount = Number(r.n);
    }
  }
  return { ok: true, data: { myVote, likeCount, dislikeCount } };
}

/** 收藏开关：有则删、无则增。 */
export async function toggleBookmark(docId: string): Promise<ActionResult<{ active: boolean }>> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: '请先登录' };
  }
  if (!uuid.safeParse(docId).success) {
    return { ok: false, error: '文档参数非法' };
  }
  const db = getDb();
  const uid = session.user.id;
  const where = and(
    eq(docReactions.userId, uid),
    eq(docReactions.documentId, docId),
    eq(docReactions.kind, 'bookmark'),
  );
  const existing = await db
    .select({ k: docReactions.kind })
    .from(docReactions)
    .where(where)
    .limit(1);
  if (existing.length > 0) {
    await db.delete(docReactions).where(where);
    return { ok: true, data: { active: false } };
  }
  await db
    .insert(docReactions)
    .values({ userId: uid, documentId: docId, kind: 'bookmark' })
    .onConflictDoNothing();
  return { ok: true, data: { active: true } };
}
