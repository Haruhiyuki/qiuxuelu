'use server';

// 文末评论（kind='doc'，一层回复）。纪律：一律经 domain can('comment.create') 取裁决+义务；
// 义务落地：pre_moderation → 入 first_post 巡查队列（M1 采事后巡查，不前置 hold，降低冷启动摩擦）；
// rate_limit → 最小间隔限速。治理隐藏走 can('comment.moderate') 并写审计。
import {
  auditLog,
  blocks,
  commentAnchors,
  comments,
  documentRefs,
  documents,
  getDb,
  reviewItems,
  revisionBlocks,
} from '@harublog/db';
import { can, explainDeny } from '@harublog/domain';
import { and, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';
import { loadActor } from '@/server/actors';
import { consentGate } from '@/server/consent';
import { insertNotification, notifyMentions } from '@/server/notifications';
import { emitTrustEvent, recomputeTrust } from '@/server/trust';

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
    .select({
      id: documents.id,
      sectionId: documents.sectionId,
      status: documents.status,
      ownerId: documents.ownerId,
      slug: documents.slug,
      title: documents.title,
    })
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
  const consentError = await consentGate(actor.id);
  if (consentError) {
    return fail(consentError);
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
  let parentAuthorId: string | null = null;
  if (rawParentId !== undefined && rawParentId.length > 0) {
    if (!uuidSchema.safeParse(rawParentId).success) {
      return fail('回复目标非法');
    }
    const parentRows = await db
      .select({
        id: comments.id,
        documentId: comments.documentId,
        parentId: comments.parentId,
        authorId: comments.authorId,
      })
      .from(comments)
      .where(eq(comments.id, rawParentId))
      .limit(1);
    const parent = parentRows[0];
    if (!parent || parent.documentId !== rawDocId || parent.parentId !== null) {
      return fail('只能回复本文的顶层评论（讨论保持一层）');
    }
    parentId = parent.id;
    parentAuthorId = parent.authorId;
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
      // 通知（同事务，insertNotification 自动跳过给自己发）
      const byName = session.user.name;
      const payload = { docId: rawDocId, slug: doc.slug, title: doc.title, byName };
      if (parentAuthorId !== null) {
        // 回复：通知被回复者
        await insertNotification(tx, {
          recipientId: parentAuthorId,
          actorId: actor.id,
          kind: 'comment_reply',
          payload,
        });
      }
      // 文章作者：避免与「回复被回复者」重复（作者恰为被回复者时只发一条）
      if (doc.ownerId !== parentAuthorId) {
        await insertNotification(tx, {
          recipientId: doc.ownerId,
          actorId: actor.id,
          kind: 'comment_on_doc',
          payload,
        });
      }
      // @提及：正文里 @用户名 的人收到 mention 通知
      await notifyMentions(tx, { text: body.data, actorId: actor.id, payload });
      // 信任：记一条评论事件并重算作者等级（可重放，跨过阈值即自动晋升）
      await emitTrustEvent(tx, {
        userId: actor.id,
        kind: 'comment_approved',
        refType: 'comment',
        refId: comment.id,
      });
      await recomputeTrust(tx, actor.id);
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

// ── 行内评论（kind='inline'，锚定到块内文本范围，架构 §3.4）──────────────────────

const anchorSchema = z.object({
  blockId: z.uuid(),
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(1),
  quotedText: z.string().trim().min(1, '请先选中要批注的文字').max(500, '选区过长'),
  prefix: z.string().max(64).optional(),
  suffix: z.string().max(64).optional(),
});

export async function createInlineComment(
  rawDocId: string,
  rawAnchor: unknown,
  rawBody: string,
): Promise<ActionResult<{ commentId: string }>> {
  const session = await getSession();
  if (!session) {
    return fail('请先登录后再批注');
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
  const anchor = anchorSchema.safeParse(rawAnchor);
  if (!anchor.success) {
    return fail(anchor.error.issues[0]?.message ?? '锚点参数非法');
  }
  if (anchor.data.endOffset <= anchor.data.startOffset) {
    return fail('选区为空');
  }
  const body = bodySchema.safeParse(rawBody);
  if (!body.success) {
    return fail(body.error.issues[0]?.message ?? '批注内容校验失败');
  }

  const doc = await loadPublishedDoc(rawDocId);
  if (doc?.status !== 'published') {
    return fail('只能对已发布的文章添加行内批注');
  }

  // 行内评论是 TL1 能力（与文末评论的 comment.create 分开）
  const decision = can(actor, 'comment.inline.create', { sectionId: doc.sectionId });
  if (!decision.allow) {
    return fail(explainDeny(decision.reason));
  }

  const db = getDb();

  // 锚定块必须属于本文、为段落/标题（纯文本偏移口径一致），且存在于当前发布修订
  const blockRows = await db
    .select({ id: blocks.id, type: blocks.type })
    .from(blocks)
    .where(and(eq(blocks.id, anchor.data.blockId), eq(blocks.documentId, rawDocId)))
    .limit(1);
  const block = blockRows[0];
  // 仅段落：其渲染 DOM 的 textContent 严格等于纯文本偏移口径（标题含锚链「#」会污染偏移）
  if (block?.type !== 'paragraph') {
    return fail('目前只能在正文段落上添加行内批注');
  }
  const refRows = await db
    .select({ revisionId: documentRefs.revisionId })
    .from(documentRefs)
    .where(and(eq(documentRefs.documentId, rawDocId), eq(documentRefs.name, 'published')))
    .limit(1);
  const publishedRevisionId = refRows[0]?.revisionId;
  if (publishedRevisionId === undefined) {
    return fail('文章尚未发布');
  }
  const inRev = await db
    .select({ blockId: revisionBlocks.blockId })
    .from(revisionBlocks)
    .where(
      and(
        eq(revisionBlocks.revisionId, publishedRevisionId),
        eq(revisionBlocks.blockId, anchor.data.blockId),
      ),
    )
    .limit(1);
  if (inRev.length === 0) {
    return fail('该段落不在当前发布版本中，无法批注');
  }

  try {
    const commentId = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(comments)
        .values({
          documentId: rawDocId,
          authorId: actor.id,
          kind: 'inline',
          body: { text: body.data },
          status: 'visible',
        })
        .returning({ id: comments.id });
      const comment = inserted[0];
      if (!comment) {
        throw new Error('insert failed');
      }
      await tx.insert(commentAnchors).values({
        commentId: comment.id,
        blockId: anchor.data.blockId,
        revisionId: publishedRevisionId,
        startOffset: anchor.data.startOffset,
        endOffset: anchor.data.endOffset,
        quotedText: anchor.data.quotedText,
        prefix: anchor.data.prefix,
        suffix: anchor.data.suffix,
        state: 'live',
      });
      await insertNotification(tx, {
        recipientId: doc.ownerId,
        actorId: actor.id,
        kind: 'comment_on_doc',
        payload: { docId: rawDocId, slug: doc.slug, title: doc.title, byName: session.user.name },
      });
      // @提及：批注正文里 @用户名 的人收到 mention 通知
      await notifyMentions(tx, {
        text: body.data,
        actorId: actor.id,
        payload: { docId: rawDocId, slug: doc.slug, title: doc.title, byName: session.user.name },
      });
      return comment.id;
    });
    return { ok: true, data: { commentId } };
  } catch {
    return fail('行内批注提交失败，请稍后重试');
  }
}
