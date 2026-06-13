import type { Capability, Role, TrustLevel } from './capabilities';

/** M0 阶段 domain 不依赖 db 包，账号状态先收敛为两态；后续若 db 增加状态需同步扩展。 */
export type ActorStatus = 'active' | 'suspended';

/**
 * 制裁种类——字面量与 db 的 sanctions.kind check 约束逐字对齐（packages/db/src/schema/governance.ts），
 * 改任一侧必须同步另一侧：
 * - silence：禁言（封锁评论类能力）
 * - no_suggest：禁建议（封锁提交编辑建议）
 * - no_edit：禁编（封锁创建/提交/直编/合并建议）
 * - suspend：封禁（除阅读外全部封锁；可板块域，全局封禁通常配合 status=suspended）
 */
export type SanctionKind = 'silence' | 'no_suggest' | 'no_edit' | 'suspend';

export interface RoleGrant {
  role: Role;
  /** editor / section_mod 必须带板块作用域；admin / superadmin 恒为 null（全局）。 */
  sectionId: string | null;
}

export interface Sanction {
  kind: SanctionKind;
  /** null = 全站生效；非 null 仅在该板块内生效。 */
  sectionId: string | null;
  /** null = 永久（直至人工解除）。 */
  endsAt: Date | null;
}

/** 鉴权所需的用户快照——由 snapshot.ts 从 db 行装配，判定器本身零 IO。 */
export interface Actor {
  id: string;
  status: ActorStatus;
  trustLevel: TrustLevel;
  roles: RoleGrant[];
  sanctions: Sanction[];
}

/**
 * 文档编辑策略（ADR-0011 简化为二元）：
 * - open（默认）：正常——由权限系统（信任/所有者/角色/可见性）治理是否可直编。
 * - locked：管理员强制锁定——谁都不能直接编辑，只能提修订申请/编辑建议（走修订模型）。
 * 早期的 suggest_only/semi/open 梯度在页面模式（ADR-0007）接管后已无独立语义，统一并入 open。
 */
export type EditPolicy = 'open' | 'locked';

export type DocStatus = 'draft' | 'published' | 'archived';

/**
 * 页面模式（ADR-0007）：私有=所有者控制（他人只能提建议，编辑可直编申请）；
 * 公共=内容被认可有公共价值，编辑接管审核管理、TL3 可直编申请。私有→公共是升级，
 * 累计他人贡献超阈值自动转、或管理员手动转；原作者身份保留。
 */
export type Visibility = 'private' | 'public';

export interface DocCtx {
  id: string;
  ownerId: string;
  editPolicy: EditPolicy;
  status: DocStatus;
  /** 页面模式：缺省视为 private（旧数据/未携带时按最严的所有者控制） */
  visibility?: Visibility;
}

export interface ResourceCtx {
  sectionId?: string;
  doc?: DocCtx;
}

/** 允许时附带的义务——调用方必须执行（进巡查队列 / 限速 / 预审），否则等同绕过治理。 */
export type Obligation =
  | { type: 'enqueue_patrol' }
  | { type: 'rate_limit'; key: string }
  | { type: 'pre_moderation'; queue: string };

export type DenyReason =
  | { kind: 'sanction'; until: Date | null }
  | { kind: 'insufficient_trust'; required: number; capability: Capability }
  | { kind: 'role_required'; roles: Role[] }
  | { kind: 'policy_locked' }
  | { kind: 'suspended' };

/** 裁决而非布尔（ADR-0005）：治理语义（义务/拒因）收口在判定器一处。 */
export type Decision =
  | { allow: true; via: 'role' | 'trust' | 'owner'; obligations: Obligation[] }
  | { allow: false; reason: DenyReason };
