'use server';

// 文末评论（kind='doc'，一层回复）。纪律：一律经 domain can('comment.create') 取裁决+义务；
// 义务落地：pre_moderation → 入 first_post 巡查队列（M1 采事后巡查，不前置 hold，降低冷启动摩擦）；
// rate_limit → 最小间隔限速。治理隐藏走 can('comment.moderate') 并写审计。
import { auditLog, comments, documents, getDb, reviewItems } from '@harublog/db';
import { can, explainDeny } from '@harublog/domain';
import { and, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';
import { loadActor } from '@/server/actors';

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const bodySchema = z.string().trim().min(1, '评论内容不能为空').max(2000, '评论最长 2000 字');
const uuidSchema = z.uuid();
// 限速最小间隔（秒）：命中 rate_limit 义务（TL0/TL1）时生效
const RATE_LIMIT_SECONDS = 10;

async function loadPublishedDoc(docId: string) {
  const db = getDb();
  const rows = await db
    .select({ id: documents.id, sectionId: documents.sectionId, status: documents.status })
    .from(documents)
    .where(eq(documents.id, docId))
    .limit(1);
  return rows[0];
}

export async function createComment(
  rawDocId: string,
  rawBody: string,
  rawParentId?: string,
): Promise<ActionResult<{ commentId: string }>> {
  const session = await getSession();
  if (!session) {
    return fail('请先登录后再评论');
  }
  const actor = await loadActor(session.user.id);
  if (!actor) {
    return fail('账号状态异常，请重新登录');
  }
  if (!uuidSchema.safeParse(rawDocId).success) {
    return fail('文档参数非法');
  }
  const body = bodySchema.safeParse(rawBody);
  if (!body.success) {
    return fail(body.error.issues[0]?.message ?? '评论内容校验失败');
  }
  const doc = await loadPublishedDoc(rawDocId);
  if (doc?.status !== 'published') {
    return fail('只能评论已发布的文章');
  }

  const decision = can(actor, 'comment.create', { sectionId: doc.sectionId });
  if (!decision.allow) {
    return fail(explainDeny(decision.reason));
  }

  const db = getDb();

  // rate_limit 义务：最小间隔限速（防刷）
  if (decision.obligations.some((o) => o.type === 'rate_limit')) {
    const since = new Date(Date.now() - RATE_LIMIT_SECONDS * 1000);
    const recent = await db
      .select({ id: comments.id })
      .from(comments)
      .where(and(eq(comments.authorId, actor.id), gt(comments.createdAt, since)))
      .limit(1);
    if (recent.length > 0) {
      return fail(`评论太频繁了，请 ${RATE_LIMIT_SECONDS} 秒后再试`);
    }
  }

  // 一层回复：父评论必须是本文同篇的顶层 doc 评论
  let parentId: string | null = null;
  if (rawParentId !== undefined && rawParentId.length > 0) {
    if (!uuidSchema.safeParse(rawParentId).success) {
      return fail('回复目标非法');
    }
    const parentRows = await db
      .select({ id: comments.id, documentId: comments.documentId, parentId: comments.parentId })
      .from(comments)
      .where(eq(comments.id, rawParentId))
      .limit(1);
    const parent = parentRows[0];
    if (!parent || parent.documentId !== rawDocId || parent.parentId !== null) {
      return fail('只能回复本文的顶层评论（讨论保持一层）');
    }
    parentId = parent.id;
  }

  const preModerate = decision.obligations.some((o) => o.type === 'pre_moderation');

  try {
    const commentId = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(comments)
        .values({
          documentId: rawDocId,
          authorId: actor.id,
          parentId,
          kind: 'doc',
          body: { text: body.data },
          status: 'visible',
        })
        .returning({ id: comments.id });
      const comment = inserted[0];
      if (!comment) {
        throw new Error('insert failed');
      }
      // pre_moderation：新人首贴入巡查队列（事后巡查，内容已可见）
      if (preModerate) {
        await tx
          .insert(reviewItems)
          .values({
            queue: 'first_post',
            subjectType: 'comment',
            subjectId: comment.id,
            sectionId: doc.sectionId,
          })
          .onConflictDoNothing();
      }
      return comment.id;
    });
    return { ok: true, data: { commentId } };
  } catch {
    return fail('评论提交失败，请稍后重试');
  }
}

const hideReasonSchema = z.string().trim().min(1, '请填写隐藏理由').max(500, '理由最长 500 字');

export async function hideComment(rawCommentId: string, rawReason: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) {
    return fail('请先登录');
  }
  const actor = await loadActor(session.user.id);
  if (!actor) {
    return fail('账号状态异常，请重新登录');
  }
  if (!uuidSchema.safeParse(rawCommentId).success) {
    return fail('评论参数非法');
  }
  const reason = hideReasonSchema.safeParse(rawReason);
  if (!reason.success) {
    return fail(reason.error.issues[0]?.message ?? '理由校验失败');
  }

  const db = getDb();
  const rows = await db
    .select({ id: comments.id, documentId: comments.documentId, sectionId: documents.sectionId })
    .from(comments)
    .innerJoin(documents, eq(documents.id, comments.documentId))
    .where(eq(comments.id, rawCommentId))
    .limit(1);
  const comment = rows[0];
  if (!comment) {
    return fail('评论不存在');
  }

  const decision = can(actor, 'comment.moderate', { sectionId: comment.sectionId });
  if (!decision.allow) {
    return fail(explainDeny(decision.reason));
  }

  try {
    await db.transaction(async (tx) => {
      // 治理隐藏保留原文（审计可见），仅状态改变
      await tx
        .update(comments)
        .set({ status: 'hidden', hiddenBy: actor.id, hiddenReason: reason.data })
        .where(eq(comments.id, rawCommentId));
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'comment.hide',
        subjectType: 'comment',
        subjectId: rawCommentId,
        sectionId: comment.sectionId,
        detail: { reason: reason.data },
      });
    });
    return { ok: true, data: null };
  } catch {
    return fail('隐藏评论失败，请稍后重试');
  }
}
