'use server';

// 文末评论（kind='doc'，一层回复）与行内批注（kind='inline'）。纪律：一律经 domain
// can('comment.create' / 'comment.inline.create') 取裁决。落库前走 DeepSeek AI 秒审（ADR-0009）：
// 放行→visible 并发通知/记信任；拦截→ai_held 隐藏、不发通知，进管理员复核队列等待放行。
// 治理隐藏走 can('comment.moderate') 并写审计。
import {
  auditLog,
  blocks,
  commentAnchors,
  comments,
  documentRefs,
  documents,
  getDb,
  revisionBlocks,
} from '@harublog/db';
import { can, explainDeny } from '@harublog/domain';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';
import { loadActor } from '@/server/actors';
import { type ModerationResult, moderateComment } from '@/server/ai-moderation';
import { consentGate } from '@/server/consent';
import { insertNotification, notifyMentions } from '@/server/notifications';
import { maybeAutoPromote } from '@/server/promote';
import { emitTrustEvent, recomputeTrust } from '@/server/trust';

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const bodySchema = z.string().trim().min(1, '评论内容不能为空').max(2000, '评论最长 2000 字');
const uuidSchema = z.uuid();

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/**
 * 评论 AI 审核裁定：受信任的审核者（comment.moderate，即板块版主+）跳过；其余送 DeepSeek。
 * 仅 verdict='block' 才拦截（ai_held），其余（off/allow/error）一律放行（fail-open）。
 */
async function moderateForStatus(
  actor: { id: string },
  sectionId: string,
  text: string,
): Promise<{ held: boolean; status: 'visible' | 'ai_held'; mod: ModerationResult }> {
  const trusted = can(actor as Parameters<typeof can>[0], 'comment.moderate', { sectionId }).allow;
  const mod: ModerationResult = trusted
    ? { verdict: 'off', category: null, reason: null, model: null }
    : await moderateComment(text);
  const held = mod.verdict === 'block';
  return { held, status: held ? 'ai_held' : 'visible', mod };
}

/** 评论转为可见时的副作用：通知（回复者/作者/@提及）+ 记信任事件。create 放行 与 管理员放行 共用。 */
async function commentSideEffects(
  tx: Tx,
  args: {
    actorId: string;
    byName: string;
    commentId: string;
    docId: string;
    slug: string;
    title: string;
    ownerId: string | null;
    parentAuthorId: string | null;
    bodyText: string;
    withTrust: boolean;
  },
): Promise<void> {
  const payload = { docId: args.docId, slug: args.slug, title: args.title, byName: args.byName };
  if (args.parentAuthorId !== null) {
    await insertNotification(tx, {
      recipientId: args.parentAuthorId,
      actorId: args.actorId,
      kind: 'comment_reply',
      payload,
    });
  }
  if (args.ownerId !== args.parentAuthorId) {
    await insertNotification(tx, {
      recipientId: args.ownerId,
      actorId: args.actorId,
      kind: 'comment_on_doc',
      payload,
    });
  }
  await notifyMentions(tx, { text: args.bodyText, actorId: args.actorId, payload });
  if (args.withTrust) {
    await emitTrustEvent(tx, {
      userId: args.actorId,
      kind: 'comment_approved',
      refType: 'comment',
      refId: args.commentId,
    });
    await recomputeTrust(tx, args.actorId);
  }
}

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
): Promise<ActionResult<{ commentId: string; held: boolean }>> {
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

  // AI 秒审：拦截则 ai_held（隐藏、进管理员复核）；放行/关闭/异常则 visible（fail-open）
  const { held, status, mod } = await moderateForStatus(actor, doc.sectionId, body.data);

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
          status,
          aiVerdict: mod.verdict,
          aiCategory: mod.category,
          aiReason: mod.reason,
          aiModel: mod.model,
        })
        .returning({ id: comments.id });
      const comment = inserted[0];
      if (!comment) {
        throw new Error('insert failed');
      }
      // 仅可见评论才发通知 / 记信任；被 AI 拦下的等管理员放行时再触发
      if (!held) {
        await commentSideEffects(tx, {
          actorId: actor.id,
          byName: session.user.name,
          commentId: comment.id,
          docId: rawDocId,
          slug: doc.slug,
          title: doc.title,
          ownerId: doc.ownerId,
          parentAuthorId,
          bodyText: body.data,
          withTrust: true,
        });
      }
      return comment.id;
    });
    // 评论是「他人贡献」之一：可见评论落库后检查是否够阈值自动转公共（ADR-0007，失败不连累主流程）
    if (!held) {
      await maybeAutoPromote(getDb(), rawDocId);
    }
    return { ok: true, data: { commentId, held } };
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
): Promise<ActionResult<{ commentId: string; held: boolean }>> {
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

  // AI 秒审：拦截则 ai_held（隐藏、进管理员复核）；其余 visible（fail-open）
  const { held, status, mod } = await moderateForStatus(actor, doc.sectionId, body.data);

  try {
    const commentId = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(comments)
        .values({
          documentId: rawDocId,
          authorId: actor.id,
          kind: 'inline',
          body: { text: body.data },
          status,
          aiVerdict: mod.verdict,
          aiCategory: mod.category,
          aiReason: mod.reason,
          aiModel: mod.model,
        })
        .returning({ id: comments.id });
      const comment = inserted[0];
      if (!comment) {
        throw new Error('insert failed');
      }
      // 锚点始终落库（放行后批注要能定位到原段落）；通知仅在可见时发
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
      if (!held) {
        const payload = {
          docId: rawDocId,
          slug: doc.slug,
          title: doc.title,
          byName: session.user.name,
        };
        await insertNotification(tx, {
          recipientId: doc.ownerId,
          actorId: actor.id,
          kind: 'comment_on_doc',
          payload,
        });
        // @提及：批注正文里 @用户名 的人收到 mention 通知
        await notifyMentions(tx, { text: body.data, actorId: actor.id, payload });
      }
      return comment.id;
    });
    if (!held) {
      await maybeAutoPromote(getDb(), rawDocId);
    }
    return { ok: true, data: { commentId, held } };
  } catch {
    return fail('行内批注提交失败，请稍后重试');
  }
}

// ── AI 复核：放行 / 删除被拦下的评论（管理员后台，需 comment.moderate）──────────────

type HeldRow = {
  id: string;
  kind: string;
  status: string;
  authorId: string | null;
  parentId: string | null;
  body: unknown;
  documentId: string;
  slug: string;
  title: string;
  ownerId: string | null;
  sectionId: string;
};
type HeldCtx =
  | { ok: false; error: string }
  | { ok: true; actorId: string; byName: string; comment: HeldRow };

/** 取 ai_held 评论 + 其文档上下文，并校验 can('comment.moderate')。 */
async function loadHeldForModeration(rawCommentId: string): Promise<HeldCtx> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: '请先登录' };
  }
  const actor = await loadActor(session.user.id);
  if (!actor) {
    return { ok: false, error: '账号状态异常，请重新登录' };
  }
  if (!uuidSchema.safeParse(rawCommentId).success) {
    return { ok: false, error: '评论参数非法' };
  }
  const rows = await getDb()
    .select({
      id: comments.id,
      kind: comments.kind,
      status: comments.status,
      authorId: comments.authorId,
      parentId: comments.parentId,
      body: comments.body,
      documentId: comments.documentId,
      slug: documents.slug,
      title: documents.title,
      ownerId: documents.ownerId,
      sectionId: documents.sectionId,
    })
    .from(comments)
    .innerJoin(documents, eq(documents.id, comments.documentId))
    .where(eq(comments.id, rawCommentId))
    .limit(1);
  const c = rows[0];
  if (!c) {
    return { ok: false, error: '评论不存在' };
  }
  if (c.status !== 'ai_held') {
    return { ok: false, error: '该评论不在待复核状态' };
  }
  const decision = can(actor, 'comment.moderate', { sectionId: c.sectionId });
  if (!decision.allow) {
    return { ok: false, error: explainDeny(decision.reason) };
  }
  return { ok: true, actorId: actor.id, byName: session.user.name, comment: c };
}

/** 放行误判：ai_held → visible，补发通知/记信任，写审计。 */
export async function releaseHeldComment(rawCommentId: string): Promise<ActionResult> {
  const ctx = await loadHeldForModeration(rawCommentId);
  if (!ctx.ok) {
    return fail(ctx.error);
  }
  const { actorId, byName, comment } = ctx;
  const bodyText =
    typeof (comment.body as { text?: unknown })?.text === 'string'
      ? (comment.body as { text: string }).text
      : '';
  // 顶层评论无 parent；回复需查被回复者以补发「回复」通知
  let parentAuthorId: string | null = null;
  if (comment.parentId !== null) {
    const p = await getDb()
      .select({ authorId: comments.authorId })
      .from(comments)
      .where(eq(comments.id, comment.parentId))
      .limit(1);
    parentAuthorId = p[0]?.authorId ?? null;
  }
  try {
    await getDb().transaction(async (tx) => {
      await tx.update(comments).set({ status: 'visible' }).where(eq(comments.id, comment.id));
      if (comment.kind === 'inline') {
        // 行内批注放行：仅通知作者 + @提及（无信任事件、无回复链）
        const payload = {
          docId: comment.documentId,
          slug: comment.slug,
          title: comment.title,
          byName,
        };
        await insertNotification(tx, {
          recipientId: comment.ownerId,
          actorId,
          kind: 'comment_on_doc',
          payload,
        });
        await notifyMentions(tx, { text: bodyText, actorId, payload });
      } else {
        await commentSideEffects(tx, {
          actorId,
          byName,
          commentId: comment.id,
          docId: comment.documentId,
          slug: comment.slug,
          title: comment.title,
          ownerId: comment.ownerId,
          parentAuthorId,
          bodyText,
          withTrust: true,
        });
      }
      await tx.insert(auditLog).values({
        actorId,
        action: 'comment.ai_release',
        subjectType: 'comment',
        subjectId: comment.id,
        sectionId: comment.sectionId,
        detail: { kind: comment.kind },
      });
    });
    await maybeAutoPromote(getDb(), comment.documentId);
    return { ok: true, data: null };
  } catch {
    return fail('放行失败，请稍后重试');
  }
}

/** 确认拦截：ai_held → deleted（永久移除），写审计。 */
export async function rejectHeldComment(rawCommentId: string): Promise<ActionResult> {
  const ctx = await loadHeldForModeration(rawCommentId);
  if (!ctx.ok) {
    return fail(ctx.error);
  }
  const { actorId, comment } = ctx;
  try {
    await getDb().transaction(async (tx) => {
      await tx
        .update(comments)
        .set({ status: 'deleted', hiddenBy: actorId, hiddenReason: 'AI 审核拦截，管理员确认' })
        .where(eq(comments.id, comment.id));
      await tx.insert(auditLog).values({
        actorId,
        action: 'comment.ai_reject',
        subjectType: 'comment',
        subjectId: comment.id,
        sectionId: comment.sectionId,
        detail: { kind: comment.kind },
      });
    });
    return { ok: true, data: null };
  } catch {
    return fail('删除失败，请稍后重试');
  }
}
