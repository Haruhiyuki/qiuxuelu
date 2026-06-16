'use server';

// 申诉：被制裁用户对某条制裁发起申诉（自归属，session 校验）；管理员复核（can('user.suspend')，admin+）：
// accepted → 撤销该制裁 + 写审计；rejected → 附说明。一条制裁至多一条「未决」申诉（部分唯一索引兜底）。
import { appeals, auditLog, getDb, sanctions } from '@harublog/db';
import { can, explainDeny } from '@harublog/domain';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';
import { loadActor } from '@/server/actors';

const uuid = z.uuid();
const reasonSchema = z.string().trim().min(1, '请填写申诉理由').max(1000, '申诉理由最长 1000 字');
const noteSchema = z.string().trim().max(1000, '说明最长 1000 字');

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function isUniqueViolation(err: unknown): boolean {
  for (let e = err; typeof e === 'object' && e !== null; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: string }).code === '23505') {
      return true;
    }
  }
  return false;
}

/** 被制裁用户对自己的某条「仍生效」制裁发起申诉。 */
export async function submitAppeal(
  rawSanctionId: string,
  rawReason: string,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session) {
    return fail('请先登录');
  }
  if (!uuid.safeParse(rawSanctionId).success) {
    return fail('参数非法');
  }
  const reason = reasonSchema.safeParse(rawReason);
  if (!reason.success) {
    return fail(reason.error.issues[0]?.message ?? '申诉理由校验失败');
  }
  const db = getDb();
  const rows = await db
    .select({
      id: sanctions.id,
      userId: sanctions.userId,
      revokedAt: sanctions.revokedAt,
      endsAt: sanctions.endsAt,
    })
    .from(sanctions)
    .where(eq(sanctions.id, rawSanctionId))
    .limit(1);
  const s = rows[0];
  if (!s) {
    return fail('制裁不存在');
  }
  if (s.userId !== session.user.id) {
    return fail('只能对自己的制裁发起申诉');
  }
  const now = new Date();
  const active = s.revokedAt === null && (s.endsAt === null || s.endsAt > now);
  if (!active) {
    return fail('该制裁已失效，无需申诉');
  }
  try {
    await db.insert(appeals).values({
      userId: session.user.id,
      sanctionId: rawSanctionId,
      reason: reason.data,
    });
    return { ok: true, data: null };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return fail('该制裁已有一条待处理的申诉，请耐心等待复核');
    }
    return fail('提交申诉失败，请稍后重试');
  }
}

/** 管理员复核申诉：accept=撤销制裁，reject=驳回（均附可选说明）。高危→写审计。 */
export async function resolveAppeal(
  rawAppealId: string,
  accept: boolean,
  rawNote?: string,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session) {
    return fail('请先登录');
  }
  const actor = await loadActor(session.user.id);
  if (actor === null) {
    return fail('请先登录');
  }
  const decision = can(actor, 'user.suspend', {});
  if (!decision.allow) {
    return fail(explainDeny(decision.reason));
  }
  if (!uuid.safeParse(rawAppealId).success) {
    return fail('参数非法');
  }
  let note: string | null = null;
  if (rawNote !== undefined && rawNote.trim().length > 0) {
    const n = noteSchema.safeParse(rawNote);
    if (!n.success) {
      return fail(n.error.issues[0]?.message ?? '说明校验失败');
    }
    note = n.data;
  }

  const db = getDb();
  try {
    await db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: appeals.id, sanctionId: appeals.sanctionId, status: appeals.status })
        .from(appeals)
        .where(eq(appeals.id, rawAppealId))
        .limit(1);
      const appeal = rows[0];
      if (!appeal) {
        throw new Error('申诉不存在');
      }
      if (appeal.status !== 'open') {
        throw new Error('该申诉已处理');
      }
      const now = new Date();
      // CAS：仅当仍为 open 才落定，防并发重复处理
      const moved = await tx
        .update(appeals)
        .set({
          status: accept ? 'accepted' : 'rejected',
          resolvedBy: actor.id,
          resolvedAt: now,
          decisionNote: note,
        })
        .where(and(eq(appeals.id, rawAppealId), eq(appeals.status, 'open')))
        .returning({ id: appeals.id });
      if (moved.length === 0) {
        throw new Error('该申诉已处理');
      }
      if (accept) {
        // 撤销该制裁（仅当仍未撤销）
        await tx
          .update(sanctions)
          .set({ revokedAt: now, revokedBy: actor.id })
          .where(and(eq(sanctions.id, appeal.sanctionId), isNull(sanctions.revokedAt)));
        await tx.insert(auditLog).values({
          actorId: actor.id,
          action: 'sanction.revoke',
          subjectType: 'sanction',
          subjectId: appeal.sanctionId,
          detail: { via: 'appeal', appealId: rawAppealId },
        });
      }
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'appeal.resolve',
        subjectType: 'appeal',
        subjectId: rawAppealId,
        detail: { accept, sanctionId: appeal.sanctionId, note },
      });
    });
    return { ok: true, data: null };
  } catch (err) {
    return fail(err instanceof Error ? err.message : '处理申诉失败，请稍后重试');
  }
}
