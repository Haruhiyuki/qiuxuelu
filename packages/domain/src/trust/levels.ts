// 贡献积分制（ADR-0016）：等级由「累计/窗口贡献分」与「是否发文」决定，纯函数可重放。
// 阈值与计分权重均落 site_settings（治理阈值不硬编码，架构 §4 + CLAUDE.md 红线）；
// 此处的 DEFAULT_THRESHOLDS 仅作 site_settings 缺失/损坏时的回落缺省。

/** 各贡献动作的计分权重（一次动作得几分）。 */
export interface TrustPointValues {
  /** 发布一篇文章 */
  publishDoc: number;
  /** 一条行内批注（可见态） */
  inlineComment: number;
  /** 一条编辑建议（feedback，不改内容的意见） */
  feedback: number;
  /** 一个修订申请被采纳（suggestion 合入主线） */
  suggestionMerged: number;
}

/**
 * 信任结算输入——由源表派生聚合而来（可重放），computeLevel 本身不碰数据库。
 * points 为全生命周期累计分（决定 TL2）；windowPoints 为近 windowDays 天窗口内的分（决定 TL3）。
 */
export interface TrustStats {
  /** 已发布文章数——发首文即达 TL1（ADR-0010 起，ADR-0016 收紧为 TL1 的唯一门槛）。 */
  publishedDocs: number;
  /** 累计贡献分（全生命周期）——决定 TL2。 */
  points: number;
  /** 近 windowDays 天窗口内贡献分——决定 TL3（窗口滑动，跌破会回落）。 */
  windowPoints: number;
}

export interface TrustThresholds {
  /** TL3 滚动考核窗口长度（天）。 */
  windowDays: number;
  /** 晋升 TL2 所需累计贡献分。 */
  tl2Points: number;
  /** 晋升 TL3 所需窗口内贡献分。 */
  tl3WindowPoints: number;
  /** 各动作计分权重。 */
  points: TrustPointValues;
}

// TL0 注册即是；TL1 发布 1 篇文章；TL2 累计 50 分；TL3 近一年窗口 150 分；
// TL4 永不自动（TL3 + 管理员颁发认证，仅人工授予，不出现在阈值表中）。
// 注意：packages/db/src/seed.ts 将本常量形状手抄入 site_settings['trust.thresholds'].thresholds
// （依赖方向禁止 db import domain）。改本类型/常量必须同步 seed 与 apps/web/server/trust.ts。
export const DEFAULT_THRESHOLDS: TrustThresholds = {
  windowDays: 365,
  tl2Points: 50,
  tl3WindowPoints: 150,
  points: {
    publishDoc: 12,
    inlineComment: 1,
    feedback: 2,
    suggestionMerged: 3,
  },
};
