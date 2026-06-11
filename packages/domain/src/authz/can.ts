import {
  type Capability,
  minTrustLevelFor,
  OWNER_CAPS,
  ROLE_CAPS,
  ROLE_ONLY_CAPS,
  rolesGranting,
  SECTION_SCOPED_ROLES,
} from './capabilities';
import type {
  Actor,
  Decision,
  DenyReason,
  Obligation,
  ResourceCtx,
  Sanction,
  SanctionKind,
} from './types';

// 制裁种类 → 封锁能力集；'all_but_read' 表示除 content.read 外全部封锁。
const SANCTION_BLOCKS: Record<SanctionKind, ReadonlySet<Capability> | 'all_but_read'> = {
  silence: new Set<Capability>(['comment.create', 'comment.inline.create']),
  no_suggest: new Set<Capability>(['suggestion.create']),
  no_edit: new Set<Capability>([
    'doc.create',
    'doc.submit',
    'doc.edit_direct',
    'suggestion.merge',
    'media.upload',
  ]),
  suspend: 'all_but_read',
};

function sanctionBlocks(sanction: Sanction, capability: Capability): boolean {
  const blocked = SANCTION_BLOCKS[sanction.kind];
  if (blocked === 'all_but_read') {
    return capability !== 'content.read';
  }
  return blocked.has(capability);
}

function sanctionScopeHits(sanction: Sanction, resource: ResourceCtx): boolean {
  if (sanction.sectionId === null) {
    return true;
  }
  return resource.sectionId === sanction.sectionId;
}

/** 多条命中制裁取最重的解除时间：永久（null）优先，否则取最晚到期。 */
function worstUntil(hits: Sanction[]): Date | null {
  let worst: Date | undefined;
  for (const s of hits) {
    if (s.endsAt === null) {
      return null;
    }
    if (worst === undefined || s.endsAt > worst) {
      worst = s.endsAt;
    }
  }
  return worst ?? null;
}

function deny(reason: DenyReason): Decision {
  return { allow: false, reason };
}

function allow(via: 'role' | 'trust' | 'owner', obligations: Obligation[] = []): Decision {
  return { allow: true, via, obligations };
}

/**
 * 唯一鉴权入口（ADR-0005）。判定顺序：
 * 制裁一票否决 → 角色线（作用域命中）→ 所有权特例 → 信任线（红线短路 + edit_policy 楼层）。
 * 纯函数零 IO；now 可注入以保证可测性。
 */
export function can(
  actor: Actor,
  capability: Capability,
  resource: ResourceCtx = {},
  now: Date = new Date(),
): Decision {
  // ── 0. 账号停用：早于一切（含角色线——停用的 admin 同样无权）
  if (actor.status === 'suspended') {
    return deny({ kind: 'suspended' });
  }

  // ── 1. 制裁一票否决：命中即拒，角色线也救不回（治理红线高于职务）
  const activeHits = actor.sanctions.filter(
    (s) =>
      (s.endsAt === null || s.endsAt > now) &&
      sanctionScopeHits(s, resource) &&
      sanctionBlocks(s, capability),
  );
  if (activeHits.length > 0) {
    return deny({ kind: 'sanction', until: worstUntil(activeHits) });
  }

  // ── 2. 角色线：板块域角色要求作用域精确命中；admin/superadmin 全局
  for (const grant of actor.roles) {
    if (!ROLE_CAPS[grant.role].includes(capability)) {
      continue;
    }
    if (SECTION_SCOPED_ROLES.has(grant.role)) {
      // 板块域角色缺作用域视为无效授予（防御 db 脏数据），资源无板块上下文也不命中
      if (grant.sectionId === null || resource.sectionId !== grant.sectionId) {
        continue;
      }
    }
    return allow('role');
  }

  const doc = resource.doc;

  // ── 3. 所有权特例：作者对自有文档（locked 不豁免——管理员强制保护压过作者自主权）
  if (doc !== undefined && doc.ownerId === actor.id) {
    const ownerFloor = OWNER_CAPS[capability];
    if (
      ownerFloor !== undefined &&
      actor.trustLevel >= ownerFloor &&
      !(capability === 'doc.edit_direct' && doc.editPolicy === 'locked')
    ) {
      return allow('owner');
    }
  }

  // ── 4. 信任线：红线短路——晋升给能力，任命给权力
  if (ROLE_ONLY_CAPS.has(capability)) {
    return deny({ kind: 'role_required', roles: rolesGranting(capability) });
  }

  // 4a. doc.edit_direct 受 edit_policy 楼层约束（覆盖 TRUST_CAPS 的基础楼层 TL3）。
  // 缺文档上下文一律 fail-close：否则信任线会绕过 edit_policy 楼层且丢失巡查义务。
  if (capability === 'doc.edit_direct') {
    if (doc === undefined) {
      return deny({ kind: 'policy_locked' });
    }
    switch (doc.editPolicy) {
      case 'suggest_only':
      case 'locked':
        return deny({ kind: 'policy_locked' });
      case 'open':
        return actor.trustLevel >= 2
          ? allow('trust', [{ type: 'enqueue_patrol' }])
          : deny({ kind: 'insufficient_trust', required: 2, capability });
      case 'semi':
        return actor.trustLevel >= 3
          ? allow('trust', [{ type: 'enqueue_patrol' }])
          : deny({ kind: 'insufficient_trust', required: 3, capability });
    }
  }

  // 4b. 评论的预审/限速梯度：TL0 允许但首帖预审+限速（拒绝变引导的最前线），TL1 限速
  if (capability === 'comment.create') {
    if (actor.trustLevel === 0) {
      return allow('trust', [
        { type: 'pre_moderation', queue: 'first_post' },
        { type: 'rate_limit', key: 'comment.create' },
      ]);
    }
    if (actor.trustLevel === 1) {
      return allow('trust', [{ type: 'rate_limit', key: 'comment.create' }]);
    }
    return allow('trust');
  }
  if (capability === 'comment.inline.create' && actor.trustLevel === 1) {
    return allow('trust', [{ type: 'rate_limit', key: 'comment.inline.create' }]);
  }

  // 4c. 通用信任楼层
  const required = minTrustLevelFor(capability);
  if (required === null) {
    return deny({ kind: 'role_required', roles: rolesGranting(capability) });
  }
  if (actor.trustLevel >= required) {
    return allow('trust');
  }
  return deny({ kind: 'insufficient_trust', required, capability });
}
