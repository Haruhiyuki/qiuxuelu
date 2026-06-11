'use server';

// 巡查队列处置（架构 §5）：协作直编已发布文章后入 edit_patrol 队列。
// 巡查通过 = 标记已巡查；巡查回退 = 创建 kind='rollback' 修订指回被改前的树并移 published ref（历史不删）。
import {
  auditLog,
  documentRefs,
  documents,
  getDb,
  hashManifest,
  publishedSnapshots,
  reviewActions,
  reviewItems,
  revisionBlocks,
  revisions,
  searchOutbox,
} from '@harublog/db';
import { can, explainDeny } from '@harublog/domain';
import { validateDoc } from '@harublog/kernel';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';
import { loadActor } from '@/server/actors';
import { insertNotification } from '@/server/notifications';
import { loadRevisionDoc } from '@/server/revision-doc';
import { emitTrustEvent, recomputeTrust } from '@/server/trust';

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const uuidSchema = z.uuid();

/** 取一条 edit_patrol 队列项及其修订上下文（修订作者、文档、所属板块）。 */
async function loadPatrolItem(db: ReturnType<typeof getDb>, revisionId: string) {
  const rows = await db
    .select({
      revisionId: revisions.id,
      documentId: revisions.documentId,
      authorId: revisions.authorId,
      parentId: revisions.parentId,
      sectionId: documents.sectionId,
      docSlug: documents.slug,
      docTitle: documents.title,
    })
    .from(revisions)
    .innerJoin(documents, eq(documents.id, revisions.documentId))
    .where(eq(revisions.id, revisionId))
    .limit(1);
  return rows[0];
}

export async function patrolApprove(rawRevisionId: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) {
    return fail('请先登录');
  }
  const actor = await loadActor(session.user.id);
  if (!actor || !uuidSchema.safeParse(rawRevisionId).success) {
    return fail('参数非法');
  }
  const db = getDb();
  const item = await loadPatrolItem(db, rawRevisionId);
  if (!item) {
    return fail('巡查对象不存在');
  }
  // 巡查权 = queue.claim（编辑+），按板块域
  const decision = can(actor, 'queue.claim', { sectionId: item.sectionId });
  if (!decision.allow) {
    return fail(explainDeny(decision.reason));
  }

  try {
    await db.transaction(async (tx) => {
      const items = await tx
        .update(reviewItems)
        .set({ status: 'done', claimedBy: actor.id })
        .where(
          and(
            eq(reviewItems.queue, 'edit_patrol'),
            eq(reviewItems.subjectType, 'revision'),
            eq(reviewItems.subjectId, rawRevisionId),
            eq(reviewItems.status, 'pending'),
          ),
        )
        .returning({ id: reviewItems.id });
      if (items.length === 0) {
        throw new Error('已处理');
      }
      const id = items[0]?.id;
      if (id !== undefined) {
        await tx
          .insert(reviewActions)
          .values({ reviewItemId: id, reviewerId: actor.id, action: 'patrol_ok' });
      }
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'patrol.approve',
        subjectType: 'revision',
        subjectId: rawRevisionId,
        sectionId: item.sectionId,
        detail: { documentId: item.documentId },
      });
    });
    return { ok: true, data: null };
  } catch {
    return fail('操作失败，该项可能已被处理');
  }
}

export async function patrolRevert(rawRevisionId: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) {
    return fail('请先登录');
  }
  const actor = await loadActor(session.user.id);
  if (!actor || !uuidSchema.safeParse(rawRevisionId).success) {
    return fail('参数非法');
  }
  const db = getDb();
  const item = await loadPatrolItem(db, rawRevisionId);
  if (!item) {
    return fail('巡查对象不存在');
  }
  if (item.parentId === null) {
    return fail('该修订没有可回退的上一版本');
  }
  // 回退是 doc.rollback 权（编辑+），按板块域
  const decision = can(actor, 'doc.rollback', { sectionId: item.sectionId });
  if (!decision.allow) {
    return fail(explainDeny(decision.reason));
  }

  try {
    await db.transaction(async (tx) => {
      // 当前 published 必须仍是这次被巡查的修订，否则期间已变，放弃（避免误回退更新内容）
      const pubRows = await tx
        .select({ revisionId: documentRefs.revisionId })
        .from(documentRefs)
        .where(
          and(eq(documentRefs.documentId, item.documentId), eq(documentRefs.name, 'published')),
        )
        .limit(1);
      const currentPublished = pubRows[0]?.revisionId;
      if (currentPublished !== rawRevisionId) {
        throw new Error('已变更');
      }

      // 目标 = 被改前的父修订的树
      const parentTree = await tx
        .select({
          position: revisionBlocks.position,
          blockId: revisionBlocks.blockId,
          blobHash: revisionBlocks.blobHash,
        })
        .from(revisionBlocks)
        .where(eq(revisionBlocks.revisionId, item.parentId as string))
        .orderBy(asc(revisionBlocks.position));
      const parentSchema = await tx
        .select({ schemaVersion: revisions.schemaVersion })
        .from(revisions)
        .where(eq(revisions.id, item.parentId as string))
        .limit(1);
      const maxSeqRows = await tx
        .select({ maxSeq: sql<number>`coalesce(max(${revisions.seq}), 0)` })
        .from(revisions)
        .where(eq(revisions.documentId, item.documentId));
      const newSeq = Number(maxSeqRows[0]?.maxSeq ?? 0) + 1;

      const revInserted = await tx
        .insert(revisions)
        .values({
          documentId: item.documentId,
          seq: newSeq,
          parentId: rawRevisionId,
          authorId: actor.id,
          committerId: actor.id,
          kind: 'rollback',
          message: '巡查回退',
          manifestHash: hashManifest(
            parentTree.map((r) => ({ blockId: r.blockId, hash: r.blobHash })),
          ),
          schemaVersion: parentSchema[0]?.schemaVersion ?? 1,
          blocksChanged: parentTree.length,
        })
        .returning({ id: revisions.id });
      const newRevisionId = revInserted[0]?.id;
      if (newRevisionId === undefined) {
        throw new Error('写入失败');
      }
      await tx.insert(revisionBlocks).values(
        parentTree.map((r) => ({
          revisionId: newRevisionId,
          position: r.position,
          blockId: r.blockId,
          blobHash: r.blobHash,
        })),
      );
      const now = new Date();
      await tx
        .update(documentRefs)
        .set({ revisionId: newRevisionId, updatedAt: now })
        .where(
          and(eq(documentRefs.documentId, item.documentId), eq(documentRefs.name, 'published')),
        );

      const assembled = await loadRevisionDoc(tx, newRevisionId);
      const snapshot = validateDoc(assembled);
      await tx
        .update(publishedSnapshots)
        .set({ revisionId: newRevisionId, content: snapshot, publishedAt: now })
        .where(eq(publishedSnapshots.documentId, item.documentId));
      await tx.update(documents).set({ updatedAt: now }).where(eq(documents.id, item.documentId));
      await tx
        .insert(searchOutbox)
        .values({ topic: 'doc.published', payload: { docId: item.documentId } });

      // 关闭巡查项 + 记动作
      const items = await tx
        .update(reviewItems)
        .set({ status: 'done', claimedBy: actor.id })
        .where(
          and(
            eq(reviewItems.queue, 'edit_patrol'),
            eq(reviewItems.subjectType, 'revision'),
            eq(reviewItems.subjectId, rawRevisionId),
          ),
        )
        .returning({ id: reviewItems.id });
      const id = items[0]?.id;
      if (id !== undefined) {
        await tx
          .insert(reviewActions)
          .values({ reviewItemId: id, reviewerId: actor.id, action: 'patrol_revert' });
      }

      // 被回退的编辑作者：记 patrol_reverted（信任惩罚）并重算、通知
      if (item.authorId !== null) {
        await emitTrustEvent(tx, {
          userId: item.authorId,
          kind: 'patrol_reverted',
          refType: 'revision',
          refId: rawRevisionId,
        });
        await recomputeTrust(tx, item.authorId);
        await insertNotification(tx, {
          recipientId: item.authorId,
          actorId: actor.id,
          kind: 'patrol_reverted',
          payload: { docId: item.documentId, slug: item.docSlug, title: item.docTitle },
        });
      }
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'patrol.revert',
        subjectType: 'revision',
        subjectId: rawRevisionId,
        sectionId: item.sectionId,
        detail: { documentId: item.documentId, revertedTo: item.parentId },
      });
    });
    return { ok: true, data: null };
  } catch {
    return fail('回退失败，该项可能已被处理或文章已更新');
  }
}
