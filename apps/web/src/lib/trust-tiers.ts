// 信任等级 × 协作权限（社区公约的权限表 与 个人资料的权限路线图 共用唯一事实源，二者永不分叉）。
// 与 @harublog/domain 的 TRUST_CAP_INCREMENTS / can() 语义一致；门槛差异源于页面模式（ADR-0007/0010）。
// 「＋」= 该等级相对上一级新增的权限（含下级全部）。

export interface TrustTier {
  /** 信任等级 0–4 */
  level: number;
  /** 公示称谓 */
  name: string;
  /** 个人博客（私有页）上对他人文章的协作权限 */
  priv: string;
  /** 公共页面上对他人文章的协作权限 */
  pub: string;
  /** 路线图备注（升级路径说明）；权限表不展示 */
  note?: string;
}

export const TRUST_TIERS: TrustTier[] = [
  { level: 0, name: '新成员', priv: '评论、发布新文章', pub: '评论、发布新文章', note: '注册即是' },
  { level: 1, name: '成员', priv: '＋行内批注', pub: '＋行内批注、编辑建议' },
  { level: 2, name: '贡献者', priv: '＋编辑建议', pub: '＋修订申请' },
  {
    level: 3,
    name: '资深贡献者',
    priv: '＋修订申请',
    pub: '＋直接修订',
    note: '按滚动窗口持续考核，跌破阈值会回落',
  },
  {
    level: 4,
    name: '共建者',
    priv: '＋审核修订申请',
    pub: '＋审核修订申请',
    note: '仅社区提名 + 人工授予，无自动达标路径',
  },
];

export const TRUST_LEVEL_NAMES: Record<number, string> = Object.fromEntries(
  TRUST_TIERS.map((t) => [t.level, t.name]),
);
