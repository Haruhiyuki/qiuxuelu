'use server';

// 发布审批两动作：通过（移 published ref + 重建快照）与驳回（理由码必填）。
// 纪律：can('doc.publish', 板块域) + 不得自审双保险；状态迁移一律走 domain transition()。
import {
  auditLog,
  documentRefs,
  documents,
  getDb,
  publishedSnapshots,
  publishRequests,
  reviewActions,
  reviewItems,
  revisions,
  searchOutbox,
} from '@harublog/db';
import type { PublishRequestStatus } from '@harublog/domain';
import {
  can,
  canActOnPublishRequest,
  explainDeny,
  transitionPublishRequest,
  WorkflowError,
} from '@harublog/domain';
import { validateDoc } from '@harublog/kernel';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { REJECT_REASON_CODES } from '@/lib/review-reasons';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';
import { loadActor } from '@/server/actors';
import { insertNotification } from '@/server/notifications';
import { loadRevisionDoc } from '@/server/revision-doc';

class ActionError extends Error {}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function toFailure(err: unknown, fallback: string): { ok: false; error: string } {
  if (err instanceof ActionError || err instanceof WorkflowError) {
    return fail(err.message);
  }
  return fail(fallback);
}

const uuidSchema = z.uuid();

interface RequestRow {
  id: string;
  documentId: string;
  revisionId: string;
  requesterId: string | null;
  status: string;
  sectionId: string;
  revisionAuthorId: string | null;
  docSlug: string;
  docTitle: string;
}

async function findRequest(requestId: string): Promise<RequestRow | undefined> {
  const db = getDb();
  const rows = await db
    .select({
      id: publishRequests.id,
      documentId: publishRequests.documentId,
      revisionId: publishRequests.revisionId,
      requesterId: publishRequests.requesterId,
      status: publishRequests.status,
      sectionId: documents.sectionId,
      revisionAuthorId: revisions.authorId,
      docSlug: documents.slug,
      docTitle: documents.title,
    })
    .from(publishRequests)
    .innerJoin(documents, eq(documents.id, publishRequests.documentId))
    .innerJoin(revisions, eq(revisions.id, publishRequests.revisionId))
    .where(eq(publishRequests.id, requestId))
    .limit(1);
  return rows[0];
}

/**
 * 准入三连：角色线鉴权（板块域）→ 不得自审 → 状态可裁决。
 * 返回错误文案或 null（通过）。
 */
function checkReviewable(
  actorId: string,
  request: RequestRow,
  decisionAllow: boolean,
  denyMessage: string | null,
): string | null {
  if (!decisionAllow) {
    return denyMessage ?? '你没有审批发布的权限';
  }
  // 自审禁令双保险（架构 §5）：直接比对 + domain 守卫。
  // 「自己」同时覆盖请求提交者与被审修订的内容作者——编辑替作者改稿后不得自批。
  const isAuthor = request.requesterId === actorId || request.revisionAuthorId === actorId;
  if (isAuthor || !canActOnPublishRequest('approve', { isAuthor, isReviewer: true })) {
    return '不能审批自己提交或自己撰写的发布请求';
  }
  // 终态（approved/rejected/withdrawn 等）先收窄再走 transition
  if (request.status !== 'pending' && request.status !== 'in_review') {
    return '该请求已被处理，无法重复裁决';
  }
  return null;
}

/** M0 无认领租约（先到先审）：pending 一次动作内合法走完 claim → 终态。 */
function resolveFinalStatus(
  current: 'pending' | 'in_review',
  action: 'approve' | 'reject',
): PublishRequestStatus {
  const inReview = current === 'pending' ? transitionPublishRequest(current, 'claim') : current;
  return transitionPublishRequest(inReview, action);
}

export async function approvePublish(rawRequestId: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) {
    return fail('请先登录');
  }
  const actor = await loadActor(session.user.id);
  if (!actor) {
    return fail('账号状态异常，请重新登录');
  }
  if (!uuidSchema.safeParse(rawRequestId).success) {
    return fail('请求参数非法');
  }
  const request = await findRequest(rawRequestId);
  if (!request) {
    return fail('发布请求不存在');
  }
  const decision = can(actor, 'doc.publish', { sectionId: request.sectionId });
  const blocked = checkReviewable(
    actor.id,
    request,
    decision.allow,
    decision.allow ? null : explainDeny(decision.reason),
  );
  if (blocked !== null) {
    return fail(blocked);
  }

  const db = getDb();
  try {
    await db.transaction(async (tx) => {
      const finalStatus = resolveFinalStatus(request.status as 'pending' | 'in_review', 'approve');
      const now = new Date();
      // 条件更新兼作并发闸门：已被他人裁决则 0 行，整体回滚
      const updated = await tx
        .update(publishRequests)
        .set({ status: finalStatus, reviewerId: actor.id, decidedAt: now })
        .where(
          and(
            eq(publishRequests.id, request.id),
            inArray(publishRequests.status, ['pending', 'in_review']),
          ),
        )
        .returning({ id: publishRequests.id });
      if (updated.length === 0) {
        throw new ActionError('该请求刚被其他审稿人处理，请刷新页面查看结果');
      }

      // 发布 = 移动 published ref 到被审批的精确修订
      await tx
        .insert(documentRefs)
        .values({
          documentId: request.documentId,
          name: 'published',
          revisionId: request.revisionId,
        })
        .onConflictDoUpdate({
          target: [documentRefs.documentId, documentRefs.name],
          set: { revisionId: request.revisionId, updatedAt: now },
        });

      // 树表是真相，快照是发布事务内同步重建的读缓存（架构 §3.1）；落库前必须过 kernel 校验
      const assembled = await loadRevisionDoc(tx, request.revisionId);
      const docJson = validateDoc(assembled);
      await tx
        .insert(publishedSnapshots)
        .values({
          documentId: request.documentId,
          revisionId: request.revisionId,
          content: docJson,
          approvedBy: actor.id,
          publishedAt: now,
        })
        .onConflictDoUpdate({
          target: publishedSnapshots.documentId,
          set: {
            revisionId: request.revisionId,
            content: docJson,
            approvedBy: actor.id,
            publishedAt: now,
          },
        });

      await tx
        .update(documents)
        .set({ status: 'published', updatedAt: now })
        .where(eq(documents.id, request.documentId));

      const items = await tx
        .update(reviewItems)
        .set({ status: 'done', claimedBy: actor.id })
        .where(
          and(
            eq(reviewItems.queue, 'new_document'),
            eq(reviewItems.subjectType, 'publish_request'),
            eq(reviewItems.subjectId, request.id),
          ),
        )
        .returning({ id: reviewItems.id });
      const item = items[0];
      if (item) {
        await tx
          .insert(reviewActions)
          .values({ reviewItemId: item.id, reviewerId: actor.id, action: 'approve' });
      }

      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'publish_request.approve',
        subjectType: 'publish_request',
        subjectId: request.id,
        sectionId: request.sectionId,
        detail: { documentId: request.documentId, revisionId: request.revisionId },
      });
      await insertNotification(tx, {
        recipientId: request.requesterId,
        actorId: actor.id,
        kind: 'publish_approved',
        payload: { docId: request.documentId, slug: request.docSlug, title: request.docTitle },
      });
      // 事务性 outbox：与发布同事务写入，worker 异步消费推送 Meilisearch（索引可全量重建）
      await tx
        .insert(searchOutbox)
        .values({ topic: 'doc.published', payload: { docId: request.documentId } });
    });
    return { ok: true, data: null };
  } catch (err) {
    return toFailure(err, '审批操作失败，请稍后重试');
  }
}

export async function rejectPublish(
  rawRequestId: string,
  rawReasonCode: string,
  rawNote: string,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session) {
    return fail('请先登录');
  }
  const actor = await loadActor(session.user.id);
  if (!actor) {
    return fail('账号状态异常，请重新登录');
  }
  if (!uuidSchema.safeParse(rawRequestId).success) {
    return fail('请求参数非法');
  }
  const reasonParsed = z.enum(REJECT_REASON_CODES).safeParse(rawReasonCode);
  if (!reasonParsed.success) {
    return fail('驳回必须选择结构化理由码');
  }
  const noteParsed = z.string().trim().max(1000, '备注最长 1000 字').safeParse(rawNote);
  if (!noteParsed.success) {
    return fail(noteParsed.error.issues[0]?.message ?? '备注校验失败');
  }
  const note = noteParsed.data.length > 0 ? noteParsed.data : null;

  const request = await findRequest(rawRequestId);
  if (!request) {
    return fail('发布请求不存在');
  }
  const decision = can(actor, 'doc.publish', { sectionId: request.sectionId });
  const blocked = checkReviewable(
    actor.id,
    request,
    decision.allow,
    decision.allow ? null : explainDeny(decision.reason),
  );
  if (blocked !== null) {
    return fail(blocked);
  }

  const db = getDb();
  try {
    await db.transaction(async (tx) => {
      const finalStatus = resolveFinalStatus(request.status as 'pending' | 'in_review', 'reject');
      const now = new Date();
      const updated = await tx
        .update(publishRequests)
        .set({
          status: finalStatus,
          reviewerId: actor.id,
          reasonCode: reasonParsed.data,
          reviewNote: note,
          decidedAt: now,
        })
        .where(
          and(
            eq(publishRequests.id, request.id),
            inArray(publishRequests.status, ['pending', 'in_review']),
          ),
        )
        .returning({ id: publishRequests.id });
      if (updated.length === 0) {
        throw new ActionError('该请求刚被其他审稿人处理，请刷新页面查看结果');
      }

      // 驳回后的文章状态取决于是否已有发布版本：首发被驳回退回草稿；
      // 已发布文章的改版被驳回时线上版本不动（绝不能误下架）。
      const publishedRef = await tx
        .select({ revisionId: documentRefs.revisionId })
        .from(documentRefs)
        .where(
          and(eq(documentRefs.documentId, request.documentId), eq(documentRefs.name, 'published')),
        )
        .limit(1);
      await tx
        .update(documents)
        .set({ status: publishedRef[0] ? 'published' : 'draft', updatedAt: now })
        .where(eq(documents.id, request.documentId));

      const items = await tx
        .update(reviewItems)
        .set({ status: 'done', claimedBy: actor.id })
        .where(
          and(
            eq(reviewItems.queue, 'new_document'),
            eq(reviewItems.subjectType, 'publish_request'),
            eq(reviewItems.subjectId, request.id),
          ),
        )
        .returning({ id: reviewItems.id });
      const item = items[0];
      if (item) {
        await tx.insert(reviewActions).values({
          reviewItemId: item.id,
          reviewerId: actor.id,
          action: 'reject',
          reasonCode: reasonParsed.data,
          note,
        });
      }

      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'publish_request.reject',
        subjectType: 'publish_request',
        subjectId: request.id,
        sectionId: request.sectionId,
        detail: { documentId: request.documentId, reasonCode: reasonParsed.data },
      });
      await insertNotification(tx, {
        recipientId: request.requesterId,
        actorId: actor.id,
        kind: 'publish_rejected',
        payload: {
          docId: request.documentId,
          slug: request.docSlug,
          title: request.docTitle,
          reasonCode: reasonParsed.data,
        },
      });
    });
    return { ok: true, data: null };
  } catch (err) {
    return toFailure(err, '驳回操作失败，请稍后重试');
  }
}
