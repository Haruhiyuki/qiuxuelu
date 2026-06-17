'use server';

// 编辑建议（反馈，ADR-0010）：对全文/片段提意见，不改内容、不进修订模型。
// 创建走 can('feedback.create')（公共 T1 / 私有 T2）；处理走 can('feedback.handle')
// （作者经 OWNER_CAPS，编辑经角色线）：设处理状态 + 回复，通知建议作者。
import { auditLog, documents, feedback, getDb } from '@harublog/db';
import { can, explainDeny } from '@harublog/domain';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';
import { loadActor } from '@/server/actors';
import { consentGate } from '@/server/consent';
import { insertNotification } from '@/server/notifications';

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const uuidSchema = z.uuid();
const bodySchema = z.string().trim().min(1, '内容不能为空').max(2000, '最长 2000 字');
const quotedSchema = z.string().trim().max(500, '引用片段最长 500 字');
const anchorSchema = z.string().trim().max(100);
const replySchema = z.string().trim().max(2000, '回复最长 2000 字');
const STATUSES = ['accepted', 'declined', 'resolved'] as const;

async function loadPublishedDoc(docId: string) {
  const rows = await getDb()
    .select({
      id: documents.id,
      sectionId: documents.sectionId,
      ownerId: documents.ownerId,
      status: documents.status,
      slug: documents.slug,
      title: documents.title,
      visibility: documents.visibility,
    })
    .from(documents)
    .where(eq(documents.id, docId))
    .limit(1);
  return rows[0];
}

function docCtx(doc: {
  id: string;
  ownerId: string | null;
  visibility: string;
  sectionId: string;
}) {
  return {
    sectionId: doc.sectionId,
    doc: {
      id: doc.id,
      ownerId: doc.ownerId ?? '',
      editPolicy: 'open' as const,
      status: 'published' as const,
      visibility: doc.visibility as 'private' | 'public',
    },
  };
}

export async function createFeedback(
  rawDocId: string,
  rawScope: string,
  rawQuoted: string,
  rawBody: string,
  rawAnchorBlockId = '',
): Promise<ActionResult<{ feedbackId: string }>> {
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
  if (!uuidSchema.safeParse(rawDocId).success) {
    return fail('文档参数非法');
  }
  const scope = rawScope === 'fragment' ? 'fragment' : 'whole';
  const body = bodySchema.safeParse(rawBody);
  if (!body.success) {
    return fail(body.error.issues[0]?.message ?? '内容校验失败');
  }
  const quoted = scope === 'fragment' ? quotedSchema.safeParse(rawQuoted) : null;
  if (quoted && !quoted.success) {
    return fail(quoted.error.issues[0]?.message ?? '引用片段校验失败');
  }
  const quotedText = scope === 'fragment' ? (quoted?.data ?? '') : null;
  if (scope === 'fragment' && (quotedText === null || quotedText.length === 0)) {
    return fail('请填写要评的片段');
  }
  // 锚点：点选段落得到的 blockId，存进 body jsonb（无需新列）；处理时可深链回原文
  const anchorBlockId =
    scope === 'fragment' ? (anchorSchema.safeParse(rawAnchorBlockId).data ?? '') : '';

  const doc = await loadPublishedDoc(rawDocId);
  if (doc?.status !== 'published') {
    return fail('只能对已发布的博客提编辑建议');
  }
  const decision = can(actor, 'feedback.create', docCtx(doc));
  if (!decision.allow) {
    return fail(explainDeny(decision.reason));
  }

  const db = getDb();
  try {
    const fid = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(feedback)
        .values({
          documentId: rawDocId,
          authorId: actor.id,
          scope,
          quotedText,
          body: anchorBlockId.length > 0 ? { text: body.data, anchorBlockId } : { text: body.data },
        })
        .returning({ id: feedback.id });
      const row = inserted[0];
      if (!row) {
        throw new Error('insert failed');
      }
      // 通知博客作者（送达后台）；@提及不解析（编辑建议非公开讨论）
      await insertNotification(tx, {
        recipientId: doc.ownerId,
        actorId: actor.id,
        kind: 'feedback_received',
        payload: { docId: rawDocId, slug: doc.slug, title: doc.title, byName: session.user.name },
      });
      return row.id;
    });
    return { ok: true, data: { feedbackId: fid } };
  } catch {
    return fail('提交失败，请稍后重试');
  }
}

export async function handleFeedback(
  rawFeedbackId: string,
  rawStatus: string,
  rawReply: string,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session) {
    return fail('请先登录');
  }
  const actor = await loadActor(session.user.id);
  if (!actor) {
    return fail('账号状态异常，请重新登录');
  }
  if (!uuidSchema.safeParse(rawFeedbackId).success) {
    return fail('参数非法');
  }
  const status = STATUSES.find((s) => s === rawStatus);
  if (status === undefined) {
    return fail('非法的处理状态');
  }
  const reply = replySchema.safeParse(rawReply);
  if (!reply.success) {
    return fail(reply.error.issues[0]?.message ?? '回复校验失败');
  }

  const db = getDb();
  const rows = await db
    .select({
      id: feedback.id,
      authorId: feedback.authorId,
      documentId: feedback.documentId,
      ownerId: documents.ownerId,
      sectionId: documents.sectionId,
      visibility: documents.visibility,
      slug: documents.slug,
      title: documents.title,
    })
    .from(feedback)
    .innerJoin(documents, eq(documents.id, feedback.documentId))
    .where(eq(feedback.id, rawFeedbackId))
    .limit(1);
  const f = rows[0];
  if (!f) {
    return fail('编辑建议不存在');
  }
  const decision = can(
    actor,
    'feedback.handle',
    docCtx({
      id: f.documentId,
      ownerId: f.ownerId,
      visibility: f.visibility,
      sectionId: f.sectionId,
    }),
  );
  if (!decision.allow) {
    return fail(explainDeny(decision.reason));
  }

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(feedback)
        .set({
          status,
          reply: reply.data.length > 0 ? reply.data : null,
          handledBy: actor.id,
          handledAt: new Date(),
        })
        .where(eq(feedback.id, rawFeedbackId));
      await insertNotification(tx, {
        recipientId: f.authorId,
        actorId: actor.id,
        kind: 'feedback_handled',
        payload: {
          docId: f.documentId,
          slug: f.slug,
          title: f.title,
          status,
          byName: session.user.name,
        },
      });
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'feedback.handle',
        subjectType: 'feedback',
        subjectId: rawFeedbackId,
        sectionId: f.sectionId,
        detail: { status },
      });
    });
    return { ok: true, data: null };
  } catch {
    return fail('处理失败，请稍后重试');
  }
}
