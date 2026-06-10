import { describe, expect, it } from 'vitest';
import { computeLevel, explainNextLevel } from '../../src/trust/compute';
import { COLD_START_THRESHOLDS, DEFAULT_THRESHOLDS, type TrustStats } from '../../src/trust/levels';

function makeStats(overrides: Partial<TrustStats> = {}): TrustStats {
  return {
    accountAgeDays: 0,
    activeDays: 0,
    commentsPosted: 0,
    window: { suggestionsMerged: 0, mergeRejectRatio: 0, flagsAccuracy: 1, activeDays: 0 },
    ...overrides,
  };
}

/** 满足 DEFAULT_THRESHOLDS 全部 TL3 条件的样本。 */
const TL3_STATS = makeStats({
  accountAgeDays: 200,
  activeDays: 120,
  commentsPosted: 50,
  window: { suggestionsMerged: 12, mergeRejectRatio: 0.1, flagsAccuracy: 0.9, activeDays: 60 },
});

describe('computeLevel', () => {
  it('全零新号 = TL0', () => {
    expect(computeLevel(makeStats(), DEFAULT_THRESHOLDS)).toBe(0);
  });

  it('仅满足 TL1 条件 = TL1', () => {
    const stats = makeStats({ accountAgeDays: 5, activeDays: 3 });
    expect(computeLevel(stats, DEFAULT_THRESHOLDS)).toBe(1);
  });

  it('满足 TL2 条件 = TL2', () => {
    const stats = makeStats({ accountAgeDays: 30, activeDays: 20, commentsPosted: 12 });
    expect(computeLevel(stats, DEFAULT_THRESHOLDS)).toBe(2);
  });

  it('窗口指标全达标 = TL3', () => {
    expect(computeLevel(TL3_STATS, DEFAULT_THRESHOLDS)).toBe(3);
  });

  it('永不自动产出 TL4——再高的指标也封顶 3', () => {
    const extreme = makeStats({
      accountAgeDays: 9999,
      activeDays: 9999,
      commentsPosted: 9999,
      window: { suggestionsMerged: 999, mergeRejectRatio: 0, flagsAccuracy: 1, activeDays: 100 },
    });
    expect(computeLevel(extreme, DEFAULT_THRESHOLDS)).toBe(3);
  });

  it('低级条件不达标时高级指标无效（等级逐级必达）', () => {
    // 窗口指标够 TL3，但评论数不够 TL2
    const stats = makeStats({
      accountAgeDays: 200,
      activeDays: 120,
      commentsPosted: 0,
      window: TL3_STATS.window,
    });
    expect(computeLevel(stats, DEFAULT_THRESHOLDS)).toBe(1);
  });

  describe('回落场景（调用方比较现等级处理降级）', () => {
    it('被拒比例跌破阈值 → 应得等级回落到 2', () => {
      const slipped = { ...TL3_STATS, window: { ...TL3_STATS.window, mergeRejectRatio: 0.5 } };
      expect(computeLevel(slipped, DEFAULT_THRESHOLDS)).toBe(2);
    });

    it('窗口活跃天数滑落 → 回落到 2', () => {
      const inactive = { ...TL3_STATS, window: { ...TL3_STATS.window, activeDays: 5 } };
      expect(computeLevel(inactive, DEFAULT_THRESHOLDS)).toBe(2);
    });

    it('举报命中率不足 → 回落到 2', () => {
      const sloppy = { ...TL3_STATS, window: { ...TL3_STATS.window, flagsAccuracy: 0.3 } };
      expect(computeLevel(sloppy, DEFAULT_THRESHOLDS)).toBe(2);
    });
  });

  describe('冷启动档', () => {
    it('同一份稀疏数据：冷启动档晋升 TL3，正式档停在 TL2', () => {
      const sparse = makeStats({
        accountAgeDays: 30,
        activeDays: 20,
        commentsPosted: 12,
        window: { suggestionsMerged: 4, mergeRejectRatio: 0.3, flagsAccuracy: 0.6, activeDays: 12 },
      });
      expect(computeLevel(sparse, COLD_START_THRESHOLDS)).toBe(3);
      expect(computeLevel(sparse, DEFAULT_THRESHOLDS)).toBe(2);
    });

    it('冷启动档 TL1 门槛更低', () => {
      const dayOne = makeStats({ accountAgeDays: 1, activeDays: 1 });
      expect(computeLevel(dayOne, COLD_START_THRESHOLDS)).toBe(1);
      expect(computeLevel(dayOne, DEFAULT_THRESHOLDS)).toBe(0);
    });
  });
});

describe('explainNextLevel', () => {
  it('TL0 → TL1：列出缺口并给出文案', () => {
    const out = explainNextLevel(makeStats({ accountAgeDays: 1 }), DEFAULT_THRESHOLDS);
    expect(out.currentLevel).toBe(0);
    expect(out.nextLevel).toBe(1);
    expect(out.gaps).toEqual([
      { metric: 'accountAgeDays', required: 2, actual: 1 },
      { metric: 'activeDays', required: 2, actual: 0 },
    ]);
    expect(out.message).toContain('TL1');
  });

  it('TL2 → TL3：「再获得 N 次建议合入」风格文案与精确缺口', () => {
    const stats = makeStats({
      accountAgeDays: 60,
      activeDays: 40,
      commentsPosted: 20,
      window: { suggestionsMerged: 7, mergeRejectRatio: 0.1, flagsAccuracy: 0.9, activeDays: 40 },
    });
    const out = explainNextLevel(stats, DEFAULT_THRESHOLDS);
    expect(out.currentLevel).toBe(2);
    expect(out.nextLevel).toBe(3);
    expect(out.gaps).toEqual([{ metric: 'window.suggestionsMerged', required: 10, actual: 7 }]);
    expect(out.message).toContain('再获得 3 次建议合入');
  });

  it('比例类缺口出现在 gaps 中且文案含百分比', () => {
    const stats = makeStats({
      accountAgeDays: 60,
      activeDays: 40,
      commentsPosted: 20,
      window: { suggestionsMerged: 12, mergeRejectRatio: 0.4, flagsAccuracy: 0.9, activeDays: 40 },
    });
    const out = explainNextLevel(stats, DEFAULT_THRESHOLDS);
    expect(out.gaps).toEqual([{ metric: 'window.mergeRejectRatio', required: 0.25, actual: 0.4 }]);
    expect(out.message).toContain('25%');
  });

  it('TL3 → TL4：无自动路径，gaps 为空且文案说明人工授予', () => {
    const out = explainNextLevel(TL3_STATS, DEFAULT_THRESHOLDS);
    expect(out.currentLevel).toBe(3);
    expect(out.nextLevel).toBe(4);
    expect(out.gaps).toEqual([]);
    expect(out.message).toContain('提名');
  });
});
