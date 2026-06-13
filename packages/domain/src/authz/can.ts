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

  const doc = resource.doc;

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
    // 页面模式红线（ADR-0007）：私有页的「审核/合并建议」只归所有者，责任编辑不获管理权
    // （编辑在私有页只能直编申请，见 4a）。板块版主及以上保留治理监督权，不受此限。
    if (
      grant.role === 'editor' &&
      (capability === 'suggestion.review' || capability === 'suggestion.merge') &&
      doc !== undefined &&
      doc.visibility !== 'public'
    ) {
      continue;
    }
    return allow('role');
  }

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

  // 4a. doc.edit_direct 信任线楼层（ADR-0007）：由页面模式驱动，editPolicy='locked' 是管理员
  //     最高冻结仍优先。role/owner 已在前面放行；走到这里的是「非角色、非所有者」的信任线用户。
  // 缺文档上下文一律 fail-close：否则信任线会绕过楼层且丢失巡查义务。
  if (capability === 'doc.edit_direct') {
    if (doc === undefined) {
      return deny({ kind: 'policy_locked' });
    }
    // 管理员强制保护：冻结后谁都不能直编（压过页面模式）
    if (doc.editPolicy === 'locked') {
      return deny({ kind: 'policy_locked' });
    }
    if (doc.visibility === 'public') {
      // 公共页：TL3+ 直编（申请）即时生效但进巡查；否则提示晋升
      return actor.trustLevel >= 3
        ? allow('trust', [{ type: 'enqueue_patrol' }])
        : deny({ kind: 'insufficient_trust', required: 3, capability });
    }
    // 私有页：信任线不得直编——TL3 只能提建议（policy_locked 文案已引导「提交编辑建议」）
    return deny({ kind: 'policy_locked' });
  }

  // 4b. 评论：AI 审核（DeepSeek 秒审）取代了预审与限速——TL0 起即可自由发评论，不附任何义务
  //     （ADR-0009）。拦截发生在动作层（落库前的 AI 审核），不在信任线表达。
  //     行内批注仍需 TL1（落入下方通用楼层），同样不再附限速。
  if (capability === 'comment.create') {
    return allow('trust');
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
