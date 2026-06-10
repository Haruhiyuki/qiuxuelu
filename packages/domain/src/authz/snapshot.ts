import type { Role, TrustLevel } from './capabilities';
import type { Actor, ActorStatus, RoleGrant, Sanction, SanctionKind } from './types';

// ── db 行的输入形状（只定形状不查库；M0 不 import @harublog/db，保持并行解耦）──
// 字段名对齐 db 包 Drizzle 行的驼峰映射；db 落地后由 dependency-cruiser 之外的集成测试对齐。

export interface UserRowLike {
  id: string;
  status: string;
  trustLevel: number;
}

export interface RoleGrantRowLike {
  role: string;
  sectionId: string | null;
  /** 任期制：到期自动失效（架构 §4），装配时过滤而非查询时过滤。 */
  expiresAt: Date | null;
}

export interface SanctionRowLike {
  kind: string;
  sectionId: string | null;
  endsAt: Date | null;
}

const ACTOR_STATUSES: ReadonlySet<string> = new Set([
  'active',
  'suspended',
] satisfies ActorStatus[]);
const ROLES: ReadonlySet<string> = new Set([
  'editor',
  'section_mod',
  'admin',
  'superadmin',
] satisfies Role[]);
const SANCTION_KINDS: ReadonlySet<string> = new Set([
  'silence',
  'no_suggest',
  'no_edit',
  'suspend',
] satisfies SanctionKind[]);

// 枚举值非法说明 db check 约束与 domain 漂移——这是必须立刻暴露的部署事故，故抛错而非静默丢弃。
function invalid(field: string, value: unknown): Error {
  return new Error(
    `Actor 快照装配失败：字段 ${field} 出现非法值 ${JSON.stringify(value)}（db 与 domain 枚举漂移）`,
  );
}

/**
 * db 行 → Actor 快照的纯装配函数（零 IO）。
 * 过期的角色授予与制裁在装配时剔除，使 can() 内只需处理「endsAt 在未来」的边界。
 */
export function assembleActor(
  input: {
    user: UserRowLike;
    roleGrants: readonly RoleGrantRowLike[];
    sanctions: readonly SanctionRowLike[];
  },
  now: Date = new Date(),
): Actor {
  const { user } = input;
  if (!ACTOR_STATUSES.has(user.status)) {
    throw invalid('user.status', user.status);
  }
  if (!Number.isInteger(user.trustLevel) || user.trustLevel < 0 || user.trustLevel > 4) {
    throw invalid('user.trustLevel', user.trustLevel);
  }

  const roles: RoleGrant[] = [];
  for (const grant of input.roleGrants) {
    if (!ROLES.has(grant.role)) {
      throw invalid('roleGrant.role', grant.role);
    }
    if (grant.expiresAt !== null && grant.expiresAt <= now) {
      continue;
    }
    roles.push({ role: grant.role as Role, sectionId: grant.sectionId });
  }

  const sanctions: Sanction[] = [];
  for (const sanction of input.sanctions) {
    if (!SANCTION_KINDS.has(sanction.kind)) {
      throw invalid('sanction.kind', sanction.kind);
    }
    if (sanction.endsAt !== null && sanction.endsAt <= now) {
      continue;
    }
    sanctions.push({
      kind: sanction.kind as SanctionKind,
      sectionId: sanction.sectionId,
      endsAt: sanction.endsAt,
    });
  }

  return {
    id: user.id,
    status: user.status as ActorStatus,
    trustLevel: user.trustLevel as TrustLevel,
    roles,
    sanctions,
  };
}
