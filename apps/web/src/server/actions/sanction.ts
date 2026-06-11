'use server';

// 制裁签发/解除（架构 §4：sanctions 一票否决，最高优先级）。签发是 user.suspend 红线能力（admin+），
// 全程审计 + 记 sanction_issued 信任事件 + 重算被制裁者等级。
import { auditLog, getDb, sanctions } from '@harublog/db';
import { can, explainDeny } from '@harublog/domain';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { SANCTION_KINDS } from '@/lib/sanction-kinds';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';
import { loadActor } from '@/server/actors';
import { emitTrustEvent, recomputeTrust } from '@/server/trust';

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const uuidSchema = z.uuid();
const reasonSchema = z.string().trim().min(1, '必须填写制裁理由').max(500, '理由最长 500 字');

export async function issueSanction(
  rawUserId: string,
  rawKind: string,
  rawReason: string,
  rawDurationDays: number | null,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session) {
    return fail('请先登录');
  }
  const actor = await loadActor(session.user.id);
  if (!actor) {
    return fail('账号状态异常，请重新登录');
  }
  const kind = z.enum(SANCTION_KINDS).safeParse(rawKind);
  if (!kind.success) {
    return fail('制裁种类非法');
  }
  const reason = reasonSchema.safeParse(rawReason);
  if (!reason.success) {
    return fail(reason.error.issues[0]?.message ?? '理由校验失败');
  }
  if (rawUserId.length === 0) {
    return fail('缺少被制裁用户');
  }
  // 制裁是全局治理权（user.suspend 红线，admin+）
  const decision = can(actor, 'user.suspend', {});
  if (!decision.allow) {
    return fail(explainDeny(decision.reason));
  }
  if (rawUserId === actor.id) {
    return fail('不能对自己签发制裁');
  }

  const endsAt =
    rawDurationDays !== null && rawDurationDays > 0
      ? new Date(Date.now() + rawDurationDays * 86_400_000)
      : null;

  const db = getDb();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(sanctions).values({
        userId: rawUserId,
        kind: kind.data,
        reason: reason.data,
        issuedBy: actor.id,
        endsAt,
      });
      await emitTrustEvent(tx, {
        userId: rawUserId,
        kind: 'sanction_issued',
        refType: 'sanction',
        payload: { kind: kind.data },
      });
      await recomputeTrust(tx, rawUserId);
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'sanction.issue',
        subjectType: 'user',
        subjectId: rawUserId,
        detail: { kind: kind.data, reason: reason.data, endsAt: endsAt?.toISOString() ?? null },
      });
    });
    return { ok: true, data: null };
  } catch {
    return fail('签发制裁失败，请稍后重试');
  }
}

export async function revokeSanction(rawSanctionId: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) {
    return fail('请先登录');
  }
  const actor = await loadActor(session.user.id);
  if (!actor) {
    return fail('账号状态异常，请重新登录');
  }
  if (!uuidSchema.safeParse(rawSanctionId).success) {
    return fail('制裁参数非法');
  }
  const decision = can(actor, 'user.suspend', {});
  if (!decision.allow) {
    return fail(explainDeny(decision.reason));
  }

  const db = getDb();
  const rows = await db
    .select({ id: sanctions.id, userId: sanctions.userId, revokedAt: sanctions.revokedAt })
    .from(sanctions)
    .where(eq(sanctions.id, rawSanctionId))
    .limit(1);
  const sanction = rows[0];
  if (!sanction) {
    return fail('制裁记录不存在');
  }
  if (sanction.revokedAt !== null) {
    return fail('该制裁已解除');
  }

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(sanctions)
        .set({ revokedAt: new Date(), revokedBy: actor.id })
        .where(eq(sanctions.id, rawSanctionId));
      await recomputeTrust(tx, sanction.userId);
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'sanction.revoke',
        subjectType: 'user',
        subjectId: sanction.userId,
        detail: { sanctionId: rawSanctionId },
      });
    });
    return { ok: true, data: null };
  } catch {
    return fail('解除制裁失败，请稍后重试');
  }
}
