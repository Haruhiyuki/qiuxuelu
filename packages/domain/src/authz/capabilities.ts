/** 全站能力清单——用字符串联合而非 enum，便于与 db 枚举、前端按钮显隐共享同一组字面量。 */
export type Capability =
  | 'content.read'
  | 'comment.create'
  | 'comment.inline.create'
  | 'comment.moderate'
  | 'suggestion.create'
  | 'suggestion.review'
  | 'suggestion.merge'
  | 'doc.create'
  | 'doc.submit'
  | 'doc.edit_direct'
  | 'media.upload'
  | 'doc.publish'
  | 'doc.unpublish'
  | 'doc.protect'
  | 'doc.feature'
  | 'doc.set_visibility'
  | 'doc.rollback'
  | 'flag.create'
  | 'flag.review'
  | 'queue.claim'
  | 'user.suspend'
  | 'user.trust_adjust'
  | 'role.grant_section'
  | 'role.grant_global'
  | 'section.manage'
  | 'announcement.manage'
  | 'system.config';

export type Role = 'editor' | 'section_mod' | 'admin' | 'superadmin';

export type TrustLevel = 0 | 1 | 2 | 3 | 4;

// 角色能力按链式展开构造（editor ⊂ section_mod ⊂ admin ⊂ superadmin），
// 防止手抄四份清单时破坏「高角色必含低角色全部能力」的不变式。
const EDITOR_CAPS: readonly Capability[] = [
  'content.read',
  'comment.create',
  'comment.inline.create',
  'suggestion.create',
  'suggestion.review',
  'suggestion.merge',
  'doc.create',
  'doc.submit',
  'doc.edit_direct',
  'media.upload',
  'doc.publish',
  'doc.rollback',
  'flag.create',
  'queue.claim',
];

const SECTION_MOD_CAPS: readonly Capability[] = [
  ...EDITOR_CAPS,
  'comment.moderate',
  'flag.review',
  'doc.unpublish',
  'doc.protect',
  'doc.feature',
  // 手动把私有页升级为公共页（自动阈值之外的人工通道，ADR-0007）
  'doc.set_visibility',
];

const ADMIN_CAPS: readonly Capability[] = [
  ...SECTION_MOD_CAPS,
  'user.suspend',
  'user.trust_adjust',
  'role.grant_section',
  'section.manage',
  // 站点新闻/公告发布（近闻页 + 首页公告栏）
  'announcement.manage',
];

const SUPERADMIN_CAPS: readonly Capability[] = [
  ...ADMIN_CAPS,
  'role.grant_global',
  'system.config',
];

export const ROLE_CAPS: Record<Role, readonly Capability[]> = {
  editor: EDITOR_CAPS,
  section_mod: SECTION_MOD_CAPS,
  admin: ADMIN_CAPS,
  superadmin: SUPERADMIN_CAPS,
};

/** editor / section_mod 的授予必须带板块作用域；admin / superadmin 为全局角色。 */
export const SECTION_SCOPED_ROLES: ReadonlySet<Role> = new Set(['editor', 'section_mod']);

// 信任能力按等级记「增量」，与 ADR-0005 的晋升语义（TLn = TL(n-1) + 新解锁）一一对应；
// TRUST_CAPS 暴露累计视图供判定器使用。
const TRUST_CAP_INCREMENTS: Record<TrustLevel, readonly Capability[]> = {
  // flag.create 从 TL0 起即可（举报权重随 TL 上升，低信任举报权重低，架构 §4.2/§5.4）
  0: ['content.read', 'doc.create', 'doc.submit', 'flag.create'],
  // media.upload 从 TL1 起（图片是垃圾/滥用向量，挡住全新 TL0 账号）
  1: ['comment.create', 'comment.inline.create', 'media.upload'],
  2: ['suggestion.create'],
  // 实际楼层受文档 edit_policy 限制（open→TL2+，semi→TL3+），见 can.ts
  3: ['doc.edit_direct'],
  4: ['suggestion.review'],
};

export const TRUST_CAPS: Record<TrustLevel, readonly Capability[]> = (() => {
  const acc: Capability[] = [];
  const out = {} as Record<TrustLevel, readonly Capability[]>;
  for (const level of [0, 1, 2, 3, 4] as const) {
    acc.push(...TRUST_CAP_INCREMENTS[level]);
    out[level] = [...acc];
  }
  return out;
})();

/** 红线：晋升给能力，任命给权力——这些能力永不经信任线授予（ADR-0005）。 */
export const ROLE_ONLY_CAPS: ReadonlySet<Capability> = new Set([
  'announcement.manage',
  'doc.publish',
  'doc.unpublish',
  'doc.protect',
  'doc.feature',
  'doc.set_visibility',
  'user.suspend',
  'user.trust_adjust',
  'role.grant_section',
  'role.grant_global',
  'section.manage',
  'system.config',
  'flag.review',
]);

/**
 * 作者对自有文档的特例能力 → 所需最低信任等级。
 * suggestion.review / suggestion.merge 设 TL2 门槛：作者 TL2 起可审自己文章的建议（架构 §5）。
 */
export const OWNER_CAPS: Partial<Record<Capability, TrustLevel>> = {
  'doc.edit_direct': 0,
  'doc.submit': 0,
  'suggestion.review': 2,
  'suggestion.merge': 2,
};

/** 信任线可授予该能力的最低等级；信任线永远拿不到（含红线）则返回 null。 */
export function minTrustLevelFor(capability: Capability): TrustLevel | null {
  if (ROLE_ONLY_CAPS.has(capability)) {
    return null;
  }
  for (const level of [0, 1, 2, 3, 4] as const) {
    if (TRUST_CAPS[level].includes(capability)) {
      return level;
    }
  }
  return null;
}

/** 拥有该能力的角色清单（供 role_required 拒因与引导文案使用）。 */
export function rolesGranting(capability: Capability): Role[] {
  return (['editor', 'section_mod', 'admin', 'superadmin'] as const).filter((role) =>
    ROLE_CAPS[role].includes(capability),
  );
}
