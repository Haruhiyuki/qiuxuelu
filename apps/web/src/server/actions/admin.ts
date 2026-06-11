'use server';

// 管理后台动作：角色任命/撤销、信任重算与手动覆盖（含 TL4 授予）。全部经 can() 红线 + 审计。
import { auditLog, getDb, roleGrants, userTrust } from '@harublog/db';
import { can, explainDeny } from '@harublog/domain';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { SECTION_SCOPED_ROLE, STAFF_ROLES } from '@/lib/roles';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';
import { loadActor } from '@/server/actors';
import { emitTrustEvent, recomputeTrust } from '@/server/trust';

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const uuidSchema = z.uuid();

export async function grantRole(
  rawUserId: string,
  rawRole: string,
  rawSectionId: string | null,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session) {
    return fail('请先登录');
  }
  const actor = await loadActor(session.user.id);
  if (!actor) {
    return fail('账号状态异常，请重新登录');
  }
  const role = z.enum(STAFF_ROLES).safeParse(rawRole);
  if (!role.success) {
    return fail('角色非法');
  }
  if (rawUserId.length === 0) {
    return fail('缺少目标用户');
  }
  const isSectionRole = SECTION_SCOPED_ROLE.has(role.data);
  if (isSectionRole && (rawSectionId === null || !uuidSchema.safeParse(rawSectionId).success)) {
    return fail('编辑/板块管理员必须指定板块');
  }
  // 板块角色 → role.grant_section（板块域）；全局角色 → role.grant_global（超管）
  const decision = isSectionRole
    ? can(actor, 'role.grant_section', { sectionId: rawSectionId ?? undefined })
    : can(actor, 'role.grant_global', {});
  if (!decision.allow) {
    return fail(explainDeny(decision.reason));
  }

  const db = getDb();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(roleGrants).values({
        userId: rawUserId,
        role: role.data,
        sectionId: isSectionRole ? rawSectionId : null,
        grantedBy: actor.id,
      });
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'role.grant',
        subjectType: 'user',
        subjectId: rawUserId,
        sectionId: isSectionRole ? rawSectionId : null,
        detail: { role: role.data, sectionId: rawSectionId },
      });
    });
    return { ok: true, data: null };
  } catch {
    return fail('任命失败，请稍后重试');
  }
}

export async function revokeRole(rawGrantId: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) {
    return fail('请先登录');
  }
  const actor = await loadActor(session.user.id);
  if (!actor || !uuidSchema.safeParse(rawGrantId).success) {
    return fail('参数非法');
  }
  const db = getDb();
  const rows = await db
    .select({
      id: roleGrants.id,
      userId: roleGrants.userId,
      role: roleGrants.role,
      sectionId: roleGrants.sectionId,
      revokedAt: roleGrants.revokedAt,
    })
    .from(roleGrants)
    .where(eq(roleGrants.id, rawGrantId))
    .limit(1);
  const grant = rows[0];
  if (!grant) {
    return fail('任命记录不存在');
  }
  if (grant.revokedAt !== null) {
    return fail('该任命已撤销');
  }
  const isSectionRole = grant.role === 'editor' || grant.role === 'section_mod';
  const decision = isSectionRole
    ? can(actor, 'role.grant_section', { sectionId: grant.sectionId ?? undefined })
    : can(actor, 'role.grant_global', {});
  if (!decision.allow) {
    return fail(explainDeny(decision.reason));
  }

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(roleGrants)
        .set({ revokedAt: new Date(), revokedBy: actor.id })
        .where(eq(roleGrants.id, rawGrantId));
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'role.revoke',
        subjectType: 'user',
        subjectId: grant.userId,
        sectionId: grant.sectionId,
        detail: { role: grant.role },
      });
    });
    return { ok: true, data: null };
  } catch {
    return fail('撤销失败，请稍后重试');
  }
}

/** 手动重算某用户信任等级（user.trust_adjust）；可重放。 */
export async function recomputeTrustForUser(
  rawUserId: string,
): Promise<ActionResult<{ level: number }>> {
  const session = await getSession();
  if (!session) {
    return fail('请先登录');
  }
  const actor = await loadActor(session.user.id);
  if (!actor || rawUserId.length === 0) {
    return fail('参数非法');
  }
  const decision = can(actor, 'user.trust_adjust', {});
  if (!decision.allow) {
    return fail(explainDeny(decision.reason));
  }
  const db = getDb();
  try {
    const result = await db.transaction(async (tx) => {
      const r = await recomputeTrust(tx, rawUserId);
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'trust.recompute',
        subjectType: 'user',
        subjectId: rawUserId,
        detail: { from: r.previousLevel, to: r.newLevel },
      });
      return r;
    });
    return { ok: true, data: { level: result.newLevel } };
  } catch {
    return fail('重算失败，请稍后重试');
  }
}

/** 手动设定信任等级（含锁定）：用于 TL4 授予、惩罚性降级或荣誉性提级（user.trust_adjust）。 */
export async function setTrustLevel(
  rawUserId: string,
  rawLevel: number,
  locked: boolean,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session) {
    return fail('请先登录');
  }
  const actor = await loadActor(session.user.id);
  if (!actor || rawUserId.length === 0) {
    return fail('参数非法');
  }
  const level = z.number().int().min(0).max(4).safeParse(rawLevel);
  if (!level.success) {
    return fail('等级必须在 0–4 之间');
  }
  const decision = can(actor, 'user.trust_adjust', {});
  if (!decision.allow) {
    return fail(explainDeny(decision.reason));
  }
  const db = getDb();
  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      await tx
        .insert(userTrust)
        .values({
          userId: rawUserId,
          level: level.data,
          locked,
          manualLevel: level.data,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: userTrust.userId,
          // 锁定时 level 跟随 manualLevel；解锁则保留当前 level，交还自动结算
          set: locked
            ? { level: level.data, locked: true, manualLevel: level.data, updatedAt: now }
            : { locked: false, manualLevel: null, updatedAt: now },
        });
      await emitTrustEvent(tx, {
        userId: rawUserId,
        kind: 'manual_adjust',
        payload: { level: level.data, locked },
      });
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'trust.set_level',
        subjectType: 'user',
        subjectId: rawUserId,
        detail: { level: level.data, locked },
      });
      // 解锁后立即按自动口径重算一次，避免停留在旧手动值
      if (!locked) {
        await recomputeTrust(tx, rawUserId, now);
      }
    });
    return { ok: true, data: null };
  } catch {
    return fail('设定失败，请稍后重试');
  }
}
