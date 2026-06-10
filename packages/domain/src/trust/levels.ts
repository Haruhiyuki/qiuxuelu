/** TL3 考核用滚动窗口指标（窗口长度 = TrustThresholds.windowDays，默认 100 天，架构 §4）。 */
export interface TrustWindowStats {
  /** 窗口内被合入的编辑建议数——晋升 TL3 的核心指标。 */
  suggestionsMerged: number;
  /** 窗口内 被拒建议 / 已裁决建议 的比例（0–1）；无已裁决建议时调用方应记 0。 */
  mergeRejectRatio: number;
  /** 窗口内举报命中率（0–1）；无举报时调用方应记 1（不因未举报而卡晋升）。 */
  flagsAccuracy: number;
  /** 窗口内活跃天数。 */
  activeDays: number;
}

/** 信任结算输入——由 trust_events 事件流重放聚合而来，computeLevel 本身不碰事件流。 */
export interface TrustStats {
  accountAgeDays: number;
  /** 累计活跃天数（全生命周期）。 */
  activeDays: number;
  /** 通过预审/未被删除的评论数。 */
  commentsPosted: number;
  window: TrustWindowStats;
}

export interface TrustThresholds {
  /** TL3 滚动考核窗口长度（天）——取数方按它聚合 window 指标。 */
  windowDays: number;
  tl1: {
    accountAgeDays: number;
    activeDays: number;
  };
  tl2: {
    activeDays: number;
    commentsPosted: number;
  };
  /** TL3 全部基于滚动窗口：达标晋升、跌破回落（回落判定由调用方比较现等级）。 */
  tl3: {
    suggestionsMerged: number;
    maxMergeRejectRatio: number;
    minFlagsAccuracy: number;
    activeDays: number;
  };
}

// TL4 永不出现在阈值表中：仅提名 + 人工授予（架构 §4）。
export const DEFAULT_THRESHOLDS: TrustThresholds = {
  windowDays: 100,
  tl1: { accountAgeDays: 2, activeDays: 2 },
  tl2: { activeDays: 15, commentsPosted: 10 },
  tl3: {
    suggestionsMerged: 10,
    maxMergeRejectRatio: 0.25,
    minFlagsAccuracy: 0.7,
    activeDays: 30,
  },
};

// 冷启动档：早期社区数据稀疏，阈值大幅调低，随规模上调（架构 §4）；两档均最终入 site_settings。
// 注意：packages/db/src/seed.ts 将本常量形状手抄入 site_settings['trust.thresholds'].thresholds
// （依赖方向禁止 db import domain）。改本类型/常量必须同步 seed。
export const COLD_START_THRESHOLDS: TrustThresholds = {
  windowDays: 100,
  tl1: { accountAgeDays: 1, activeDays: 1 },
  tl2: { activeDays: 5, commentsPosted: 3 },
  tl3: {
    suggestionsMerged: 3,
    maxMergeRejectRatio: 0.4,
    minFlagsAccuracy: 0.5,
    activeDays: 10,
  },
};
