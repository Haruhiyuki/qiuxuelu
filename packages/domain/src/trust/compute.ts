import type { TrustStats, TrustThresholds } from './levels';

/** 自动结算只产出 0–3；TL4 永不自动（仅提名 + 人工授予）。 */
export type ComputedLevel = 0 | 1 | 2 | 3;

function meetsTl1(stats: TrustStats, t: TrustThresholds): boolean {
  // 发首文即达 T1（ADR-0010）；否则走「账号年龄 + 活跃天数」阈值
  if (stats.publishedDocs >= 1) {
    return true;
  }
  return stats.accountAgeDays >= t.tl1.accountAgeDays && stats.activeDays >= t.tl1.activeDays;
}

function meetsTl2(stats: TrustStats, t: TrustThresholds): boolean {
  return stats.activeDays >= t.tl2.activeDays && stats.commentsPosted >= t.tl2.commentsPosted;
}

function meetsTl3(stats: TrustStats, t: TrustThresholds): boolean {
  const w = stats.window;
  return (
    w.suggestionsMerged >= t.tl3.suggestionsMerged &&
    w.mergeRejectRatio <= t.tl3.maxMergeRejectRatio &&
    w.flagsAccuracy >= t.tl3.minFlagsAccuracy &&
    w.activeDays >= t.tl3.activeDays
  );
}

/**
 * 纯函数结算当前应得等级。等级逐级必达（高等级必满足全部低级条件）。
 * TL3 基于滚动窗口可回落：本函数只算「应得」，与现等级比较后的回落/锁定处理由调用方负责
 * （管理员锁定/手动覆盖同样在调用方层面生效）。
 */
export function computeLevel(stats: TrustStats, thresholds: TrustThresholds): ComputedLevel {
  if (!meetsTl1(stats, thresholds)) {
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
  metric:
    | 'accountAgeDays'
    | 'activeDays'
    | 'commentsPosted'
    | 'window.suggestionsMerged'
    | 'window.mergeRejectRatio'
    | 'window.flagsAccuracy'
    | 'window.activeDays';
  /** 对比例类指标为上/下界，对计数类指标为最低要求。 */
  required: number;
  actual: number;
}

export interface NextLevelExplanation {
  currentLevel: ComputedLevel;
  /** 已是 TL3 时下一级为 4（仅人工）；gaps 为空。 */
  nextLevel: 1 | 2 | 3 | 4;
  gaps: LevelGap[];
  /** 中文引导文案——「再获得 N 次建议合入即可解锁……」风格。 */
  message: string;
}

function asPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** 距下一等级的缺口 + 引导文案；与 explainDeny 配合把每一次拒绝变成晋升路标。 */
export function explainNextLevel(
  stats: TrustStats,
  thresholds: TrustThresholds,
): NextLevelExplanation {
  const currentLevel = computeLevel(stats, thresholds);
  const gaps: LevelGap[] = [];
  const parts: string[] = [];

  switch (currentLevel) {
    case 0: {
      const { tl1 } = thresholds;
      if (stats.accountAgeDays < tl1.accountAgeDays) {
        gaps.push({
          metric: 'accountAgeDays',
          required: tl1.accountAgeDays,
          actual: stats.accountAgeDays,
        });
        parts.push(
          `注册满 ${tl1.accountAgeDays} 天（还差 ${tl1.accountAgeDays - stats.accountAgeDays} 天）`,
        );
      }
      if (stats.activeDays < tl1.activeDays) {
        gaps.push({ metric: 'activeDays', required: tl1.activeDays, actual: stats.activeDays });
        parts.push(`再活跃 ${tl1.activeDays - stats.activeDays} 天`);
      }
      return {
        currentLevel,
        nextLevel: 1,
        gaps,
        message: `${parts.join('、')}即可晋升 TL1（成员），解锁评论与行内评论。`,
      };
    }
    case 1: {
      const { tl2 } = thresholds;
      if (stats.commentsPosted < tl2.commentsPosted) {
        gaps.push({
          metric: 'commentsPosted',
          required: tl2.commentsPosted,
          actual: stats.commentsPosted,
        });
        parts.push(`再发表 ${tl2.commentsPosted - stats.commentsPosted} 条评论`);
      }
      if (stats.activeDays < tl2.activeDays) {
        gaps.push({ metric: 'activeDays', required: tl2.activeDays, actual: stats.activeDays });
        parts.push(`再活跃 ${tl2.activeDays - stats.activeDays} 天`);
      }
      return {
        currentLevel,
        nextLevel: 2,
        gaps,
        message: `${parts.join('、')}即可晋升 TL2（贡献者），解锁编辑建议。`,
      };
    }
    case 2: {
      const { tl3 } = thresholds;
      const w = stats.window;
      if (w.suggestionsMerged < tl3.suggestionsMerged) {
        gaps.push({
          metric: 'window.suggestionsMerged',
          required: tl3.suggestionsMerged,
          actual: w.suggestionsMerged,
        });
        parts.push(`再获得 ${tl3.suggestionsMerged - w.suggestionsMerged} 次建议合入`);
      }
      if (w.mergeRejectRatio > tl3.maxMergeRejectRatio) {
        gaps.push({
          metric: 'window.mergeRejectRatio',
          required: tl3.maxMergeRejectRatio,
          actual: w.mergeRejectRatio,
        });
        parts.push(
          `将建议被拒比例降至 ${asPercent(tl3.maxMergeRejectRatio)} 以下（当前 ${asPercent(w.mergeRejectRatio)}）`,
        );
      }
      if (w.flagsAccuracy < tl3.minFlagsAccuracy) {
        gaps.push({
          metric: 'window.flagsAccuracy',
          required: tl3.minFlagsAccuracy,
          actual: w.flagsAccuracy,
        });
        parts.push(
          `将举报命中率提升至 ${asPercent(tl3.minFlagsAccuracy)} 以上（当前 ${asPercent(w.flagsAccuracy)}）`,
        );
      }
      if (w.activeDays < tl3.activeDays) {
        gaps.push({ metric: 'window.activeDays', required: tl3.activeDays, actual: w.activeDays });
        parts.push(`近 ${thresholds.windowDays} 天内再活跃 ${tl3.activeDays - w.activeDays} 天`);
      }
      return {
        currentLevel,
        nextLevel: 3,
        gaps,
        message: `${parts.join('、')}即可晋升 TL3（资深），解锁开放文档直接编辑。`,
      };
    }
    case 3:
      return {
        currentLevel,
        nextLevel: 4,
        gaps: [],
        message: 'TL4（共建者）由社区提名并人工授予，没有自动达标路径——持续的高质量贡献会被看见。',
      };
  }
}
