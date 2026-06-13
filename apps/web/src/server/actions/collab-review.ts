'use server';

// 公示页评议（ADR-0010）：对协作项（编辑建议/修订申请/修订记录）打赞同度分（1–5）+ 评论。
// 仅公共页开放；一人对一项一条（再次提交即更新）。受 silence 制裁约束（走 can('comment.create')）。
import { collabReviews, documents, feedback, getDb, revisions, suggestions } from '@harublog/db';
import { can, explainDeny } from '@harublog/domain';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';
import { loadActor } from '@/server/actors';
import { consentGate } from '@/server/consent';

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const uuidSchema = z.uuid();
const commentSchema = z.string().trim().max(1000, '评论最长 1000 字');
const TARGETS = ['feedback', 'suggestion', 'revision'] as const;
type Target = (typeof TARGETS)[number];

/** 取协作项所属文档 id（按类型查对应表）。 */
async function resolveDocId(targetType: Target, targetId: string): Promise<string | null> {
  const db = getDb();
  if (targetType === 'feedback') {
    const r = await db
      .select({ d: feedback.documentId })
      .from(feedback)
      .where(eq(feedback.id, targetId))
      .limit(1);
    return r[0]?.d ?? null;
  }
  if (targetType === 'suggestion') {
    const r = await db
      .select({ d: suggestions.documentId })
      .from(suggestions)
      .where(eq(suggestions.id, targetId))
      .limit(1);
    return r[0]?.d ?? null;
  }
  const r = await db
    .select({ d: revisions.documentId })
    .from(revisions)
    .where(eq(revisions.id, targetId))
    .limit(1);
  return r[0]?.d ?? null;
}

export async function rateCollabItem(
  rawTargetType: string,
  rawTargetId: string,
  rawRating: number,
  rawComment: string,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session) {
    return fail('请先登录');
  }
  const actor = await loadActor(session.user.id);
  if (!actor) {
    return fail('账号状态异常，请重新登录');
  }
  const consentError = await consentGate(actor.id);
  if (consentError) {
    return fail(consentError);
  }
  const targetType = TARGETS.find((t) => t === rawTargetType);
  if (targetType === undefined) {
    return fail('参数非法');
  }
  if (!uuidSchema.safeParse(rawTargetId).success) {
    return fail('参数非法');
  }
  const rating = Math.round(Number(rawRating));
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return fail('请打 1–5 分');
  }
  const comment = commentSchema.safeParse(rawComment);
  if (!comment.success) {
    return fail(comment.error.issues[0]?.message ?? '评论校验失败');
  }

  const docId = await resolveDocId(targetType, rawTargetId);
  if (docId === null) {
    return fail('协作项不存在');
  }
  const docRows = await getDb()
    .select({ sectionId: documents.sectionId, visibility: documents.visibility })
    .from(documents)
    .where(eq(documents.id, docId))
    .limit(1);
  const doc = docRows[0];
  if (!doc) {
    return fail('文章不存在');
  }
  if (doc.visibility !== 'public') {
    return fail('评议仅对公共页文章开放');
  }
  // 借 comment.create 守 silence 制裁（TL0+ 即可评议）
  const decision = can(actor, 'comment.create', { sectionId: doc.sectionId });
  if (!decision.allow) {
    return fail(explainDeny(decision.reason));
  }

  const body = comment.data.length > 0 ? { text: comment.data } : null;
  try {
    await getDb()
      .insert(collabReviews)
      .values({
        targetType,
        targetId: rawTargetId,
        documentId: docId,
        authorId: actor.id,
        rating,
        body,
      })
      .onConflictDoUpdate({
        target: [collabReviews.targetType, collabReviews.targetId, collabReviews.authorId],
        set: { rating, body, createdAt: new Date() },
      });
    return { ok: true, data: null };
  } catch {
    return fail('提交失败，请稍后重试');
  }
}
