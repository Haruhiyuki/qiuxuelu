import { getDb, roleGrants, sanctions, user as userTable, userTrust } from '@harublog/db';
import type { Actor, Capability } from '@harublog/domain';
import { assembleActor, ROLE_CAPS } from '@harublog/domain';
import { and, eq, isNull, lte } from 'drizzle-orm';

/** 信任值越界说明 db 与 domain 已漂移——立即抛错暴露，绝不静默夹紧放行。 */
function assertLevel(level: number): number {
  if (!Number.isInteger(level) || level < 0 || level > 4) {
    throw new Error(`信任等级越界：${level}（合法范围 0-4），db 与 domain 可能已漂移`);
  }
  return level;
}

/**
 * 从 user + user_trust + role_grants + sanctions 装配 domain Actor 快照。
 * 单条 SQL（双左连接的笛卡尔积行数 = 角色数 × 制裁数，单用户量级极小），
 * 请求级调用一次后在内存传递；过期授予/制裁的剔除交给 assembleActor。
 */
export async function loadActor(userId: string): Promise<Actor | null> {
  const db = getDb();
  const now = new Date();
  const rows = await db
    .select({
      status: userTable.status,
      level: userTrust.level,
      locked: userTrust.locked,
      manualLevel: userTrust.manualLevel,
      grantId: roleGrants.id,
      grantRole: roleGrants.role,
      grantSectionId: roleGrants.sectionId,
      grantExpiresAt: roleGrants.expiresAt,
      sanctionId: sanctions.id,
      sanctionKind: sanctions.kind,
      sanctionSectionId: sanctions.sectionId,
      sanctionEndsAt: sanctions.endsAt,
    })
    .from(userTable)
    .leftJoin(userTrust, eq(userTrust.userId, userTable.id))
    .leftJoin(roleGrants, and(eq(roleGrants.userId, userTable.id), isNull(roleGrants.revokedAt)))
    .leftJoin(
      sanctions,
      and(
        eq(sanctions.userId, userTable.id),
        isNull(sanctions.revokedAt),
        lte(sanctions.startsAt, now),
      ),
    )
    .where(eq(userTable.id, userId));

  const first = rows[0];
  if (!first) {
    return null;
  }

  const grantRows = new Map<
    string,
    { role: string; sectionId: string | null; expiresAt: Date | null }
  >();
  const sanctionRows = new Map<
    string,
    { kind: string; sectionId: string | null; endsAt: Date | null }
  >();
  for (const row of rows) {
    if (row.grantId !== null && row.grantRole !== null) {
      grantRows.set(row.grantId, {
        role: row.grantRole,
        sectionId: row.grantSectionId,
        expiresAt: row.grantExpiresAt,
      });
    }
    if (row.sanctionId !== null && row.sanctionKind !== null) {
      sanctionRows.set(row.sanctionId, {
        // db 与 domain 的 SanctionKind 字面量已逐字对齐，未知值由 assembleActor 抛错暴露
        kind: row.sanctionKind,
        sectionId: row.sanctionSectionId,
        endsAt: row.sanctionEndsAt,
      });
    }
  }

  // 管理员锁定 + 手动覆盖：locked 时以 manual_level 为准（无手动值则维持物化 level）
  const baseLevel = first.level ?? 0;
  const effectiveLevel =
    first.locked === true && first.manualLevel !== null && first.manualLevel !== undefined
      ? first.manualLevel
      : baseLevel;

  return assembleActor(
    {
      user: { id: userId, status: first.status, trustLevel: assertLevel(effectiveLevel) },
      roleGrants: [...grantRows.values()],
      sanctions: [...sanctionRows.values()],
    },
    now,
  );
}

/** 是否持有可发布角色（页面级守卫/导航显隐用；具体审批仍须按板块域走 can()）。 */
export function hasPublishGrant(actor: Actor): boolean {
  return actor.roles.some((grant) => ROLE_CAPS[grant.role].includes('doc.publish'));
}

/**
 * 行使某能力的板块作用域：'all' = 持有该能力的全局角色；数组 = 板块域角色覆盖的板块集。
 * 队列页（审批/举报/巡查）的列表与预览都必须按它收窄，防跨板块越权读取。
 */
export function sectionScopeForCapability(actor: Actor, capability: Capability): 'all' | string[] {
  const ids = new Set<string>();
  for (const grant of actor.roles) {
    if (!ROLE_CAPS[grant.role].includes(capability)) {
      continue;
    }
    if (grant.sectionId === null) {
      return 'all';
    }
    ids.add(grant.sectionId);
  }
  return [...ids];
}

/** 可行使发布权的板块集合（审批工作台用）。 */
export function publishableSectionIds(actor: Actor): 'all' | string[] {
  return sectionScopeForCapability(actor, 'doc.publish');
}
