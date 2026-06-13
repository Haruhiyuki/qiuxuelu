'use server';

// 板块治理动作（精选 / 内容保护 / 页面模式升级）：先 can() 再干活，写审计。
import { auditLog, documents, getDb } from '@harublog/db';
import { can, type DocCtx, explainDeny } from '@harublog/domain';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';
import { loadActor } from '@/server/actors';
import { promoteToPublic } from '@/server/promote';

export async function toggleFeatured(docId: string, featured: boolean): Promise<ActionResult> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: '请先登录' };
  }
  const actor = await loadActor(session.user.id);
  if (!actor) {
    return { ok: false, error: '账号状态异常，请重新登录' };
  }
  const db = getDb();
  const doc = (
    await db
      .select({ sectionId: documents.sectionId })
      .from(documents)
      .where(eq(documents.id, docId))
      .limit(1)
  )[0];
  if (!doc) {
    return { ok: false, error: '文章不存在' };
  }
  const decision = can(actor, 'doc.feature', { sectionId: doc.sectionId });
  if (!decision.allow) {
    return { ok: false, error: explainDeny(decision.reason) };
  }
  await db.transaction(async (tx) => {
    await tx.update(documents).set({ featured }).where(eq(documents.id, docId));
    await tx.insert(auditLog).values({
      actorId: actor.id,
      action: 'doc.feature',
      subjectType: 'document',
      subjectId: docId,
      sectionId: doc.sectionId,
      detail: { featured },
    });
  });
  return { ok: true, data: null };
}

const POLICIES = ['open', 'locked'] as const;

export async function setEditPolicy(docId: string, policy: string): Promise<ActionResult> {
  if (!POLICIES.includes(policy as (typeof POLICIES)[number])) {
    return { ok: false, error: '非法的锁定状态' };
  }
  const session = await getSession();
  if (!session) {
    return { ok: false, error: '请先登录' };
  }
  const actor = await loadActor(session.user.id);
  if (!actor) {
    return { ok: false, error: '账号状态异常，请重新登录' };
  }
  const db = getDb();
  const doc = (
    await db
      .select({
        sectionId: documents.sectionId,
        ownerId: documents.ownerId,
        status: documents.status,
      })
      .from(documents)
      .where(eq(documents.id, docId))
      .limit(1)
  )[0];
  if (!doc) {
    return { ok: false, error: '文章不存在' };
  }
  const decision = can(actor, 'doc.protect', {
    sectionId: doc.sectionId,
    doc: {
      id: docId,
      ownerId: doc.ownerId ?? '',
      editPolicy: policy as DocCtx['editPolicy'],
      status: doc.status as DocCtx['status'],
    },
  });
  if (!decision.allow) {
    return { ok: false, error: explainDeny(decision.reason) };
  }
  await db.transaction(async (tx) => {
    await tx.update(documents).set({ editPolicy: policy }).where(eq(documents.id, docId));
    await tx.insert(auditLog).values({
      actorId: actor.id,
      action: 'doc.protect',
      subjectType: 'document',
      subjectId: docId,
      sectionId: doc.sectionId,
      detail: { editPolicy: policy },
    });
  });
  return { ok: true, data: null };
}

/** 管理员手动把私有页升级为公共页（自动阈值之外的人工通道，ADR-0007）。 */
export async function publicizeDocument(docId: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: '请先登录' };
  }
  const actor = await loadActor(session.user.id);
  if (!actor) {
    return { ok: false, error: '账号状态异常，请重新登录' };
  }
  const db = getDb();
  const doc = (
    await db
      .select({ sectionId: documents.sectionId, visibility: documents.visibility })
      .from(documents)
      .where(eq(documents.id, docId))
      .limit(1)
  )[0];
  if (!doc) {
    return { ok: false, error: '文章不存在' };
  }
  const decision = can(actor, 'doc.set_visibility', { sectionId: doc.sectionId });
  if (!decision.allow) {
    return { ok: false, error: explainDeny(decision.reason) };
  }
  if (doc.visibility === 'public') {
    return { ok: true, data: null };
  }
  await promoteToPublic(db, docId, actor.id, 'manual', {
    sectionId: doc.sectionId,
    actorId: actor.id,
  });
  return { ok: true, data: null };
}
