import { describe, expect, it } from 'vitest';
import { computeLevel, explainNextLevel } from '../../src/trust/compute';
import { DEFAULT_THRESHOLDS, type TrustStats } from '../../src/trust/levels';

function makeStats(overrides: Partial<TrustStats> = {}): TrustStats {
  return { publishedDocs: 0, points: 0, windowPoints: 0, ...overrides };
}

// windowDays 365 / tl2Points 50 / tl3WindowPoints 150 / 发文12·批注1·建议2·合入3
const T = DEFAULT_THRESHOLDS;

describe('computeLevel（积分制 ADR-0016）', () => {
  it('全零新号 = TL0', () => {
    expect(computeLevel(makeStats(), T)).toBe(0);
  });

  it('未发文即便有分也停在 TL0（TL1 唯一门槛 = 发文）', () => {
    expect(computeLevel(makeStats({ points: 999, windowPoints: 999 }), T)).toBe(0);
  });

  it('发布 1 篇文章即达 TL1', () => {
    expect(computeLevel(makeStats({ publishedDocs: 1 }), T)).toBe(1);
  });

  it('已发文 + 累计满 50 分 = TL2', () => {
    expect(computeLevel(makeStats({ publishedDocs: 1, points: 50, windowPoints: 0 }), T)).toBe(2);
  });

  it('累计差 1 分 = 停在 TL1', () => {
    expect(computeLevel(makeStats({ publishedDocs: 1, points: 49 }), T)).toBe(1);
  });

  it('窗口满 150 分 = TL3', () => {
    expect(computeLevel(makeStats({ publishedDocs: 1, points: 200, windowPoints: 150 }), T)).toBe(
      3,
    );
  });

  it('窗口差 1 分 = 停在 TL2', () => {
    expect(computeLevel(makeStats({ publishedDocs: 1, points: 200, windowPoints: 149 }), T)).toBe(
      2,
    );
  });

  it('永不自动产出 TL4——再高的分也封顶 3', () => {
    expect(computeLevel(makeStats({ publishedDocs: 9, points: 9999, windowPoints: 9999 }), T)).toBe(
      3,
    );
  });

  it('窗口分回落到阈值以下 → 应得等级回落到 2（调用方据此降级）', () => {
    const slipped = makeStats({ publishedDocs: 1, points: 300, windowPoints: 80 });
    expect(computeLevel(slipped, T)).toBe(2);
  });
});

describe('explainNextLevel', () => {
  it('TL0 → TL1：缺口 = 发布文章', () => {
    const out = explainNextLevel(makeStats(), T);
    expect(out.currentLevel).toBe(0);
    expect(out.nextLevel).toBe(1);
    expect(out.gaps).toEqual([{ metric: 'publishedDocs', required: 1, actual: 0 }]);
    expect(out.message).toContain('发布 1 篇文章');
  });

  it('TL1 → TL2：「再积累 N 分」缺口与文案', () => {
    const out = explainNextLevel(makeStats({ publishedDocs: 1, points: 30 }), T);
    expect(out.currentLevel).toBe(1);
    expect(out.nextLevel).toBe(2);
    expect(out.gaps).toEqual([{ metric: 'points', required: 50, actual: 30 }]);
    expect(out.message).toContain('再积累 20 分');
  });

  it('TL2 → TL3：近一年窗口分缺口', () => {
    const out = explainNextLevel(makeStats({ publishedDocs: 1, points: 80, windowPoints: 100 }), T);
    expect(out.currentLevel).toBe(2);
    expect(out.nextLevel).toBe(3);
    expect(out.gaps).toEqual([{ metric: 'windowPoints', required: 150, actual: 100 }]);
    expect(out.message).toContain('再积累 50 分');
  });

  it('TL3 → TL4：无自动路径，gaps 为空且文案说明管理员认证', () => {
    const out = explainNextLevel(
      makeStats({ publishedDocs: 1, points: 300, windowPoints: 150 }),
      T,
    );
    expect(out.currentLevel).toBe(3);
    expect(out.nextLevel).toBe(4);
    expect(out.gaps).toEqual([]);
    expect(out.message).toContain('管理员');
  });
});
