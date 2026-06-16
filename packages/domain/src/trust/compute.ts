import type { TrustStats, TrustThresholds } from './levels';

/** 自动结算只产出 0–3；TL4 永不自动（TL3 + 管理员颁发认证，仅人工授予）。 */
export type ComputedLevel = 0 | 1 | 2 | 3;

// TL1：发布 1 篇文章即达（ADR-0016）。
function meetsTl1(stats: TrustStats): boolean {
  return stats.publishedDocs >= 1;
}
// TL2：累计贡献分达标。
function meetsTl2(stats: TrustStats, t: TrustThresholds): boolean {
  return stats.points >= t.tl2Points;
}
// TL3：近 windowDays 天窗口内贡献分达标（窗口滑动，跌破会回落）。
function meetsTl3(stats: TrustStats, t: TrustThresholds): boolean {
  return stats.windowPoints >= t.tl3WindowPoints;
}

/**
 * 纯函数结算当前应得等级。等级逐级必达（高等级必满足全部低级条件）。
 * TL3 基于滚动窗口可回落：本函数只算「应得」，与现等级比较后的回落/锁定处理由调用方负责
 * （管理员锁定/手动覆盖、TL4 人工授予同样在调用方层面生效）。
 */
export function computeLevel(stats: TrustStats, thresholds: TrustThresholds): ComputedLevel {
  if (!meetsTl1(stats)) {
    return 0;
  }
  if (!meetsTl2(stats, thresholds)) {
    return 1;
  }
  if (!meetsTl3(stats, thresholds)) {
    return 2;
  }
  return 3;
}

export interface LevelGap {
  metric: 'publishedDocs' | 'points' | 'windowPoints';
  required: number;
  actual: number;
}

export interface NextLevelExplanation {
  currentLevel: ComputedLevel;
  /** 已是 TL3 时下一级为 4（仅人工）；gaps 为空。 */
  nextLevel: 1 | 2 | 3 | 4;
  gaps: LevelGap[];
  /** 中文引导文案——「再积累 N 分即可解锁……」风格。 */
  message: string;
}

/** 距下一等级的缺口 + 引导文案；与 explainDeny 配合把每一次拒绝变成晋升路标。 */
export function explainNextLevel(
  stats: TrustStats,
  thresholds: TrustThresholds,
): NextLevelExplanation {
  const currentLevel = computeLevel(stats, thresholds);

  switch (currentLevel) {
    case 0:
      return {
        currentLevel,
        nextLevel: 1,
        gaps: [{ metric: 'publishedDocs', required: 1, actual: stats.publishedDocs }],
        message: '发布 1 篇文章即可晋升 TL1（成员），解锁行内批注。',
      };
    case 1: {
      const remaining = thresholds.tl2Points - stats.points;
      return {
        currentLevel,
        nextLevel: 2,
        gaps: [{ metric: 'points', required: thresholds.tl2Points, actual: stats.points }],
        message: `再积累 ${remaining} 分（当前 ${stats.points}/${thresholds.tl2Points}）即可晋升 TL2（贡献者），解锁编辑建议。`,
      };
    }
    case 2: {
      const remaining = thresholds.tl3WindowPoints - stats.windowPoints;
      return {
        currentLevel,
        nextLevel: 3,
        gaps: [
          {
            metric: 'windowPoints',
            required: thresholds.tl3WindowPoints,
            actual: stats.windowPoints,
          },
        ],
        message: `近一年内再积累 ${remaining} 分（当前 ${stats.windowPoints}/${thresholds.tl3WindowPoints}）即可晋升 TL3（资深贡献者），解锁公共页直接修订与修订申请。`,
      };
    }
    case 3:
      return {
        currentLevel,
        nextLevel: 4,
        gaps: [],
        message: 'TL4（共建者）在 TL3 基础上由管理员颁发认证授予——持续的高质量贡献会被看见。',
      };
  }
}
