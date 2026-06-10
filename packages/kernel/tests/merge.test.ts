import { describe, expect, it } from 'vitest';
import type { MergeResult } from '../src/merge/index';
import { threeWayMerge } from '../src/merge/index';
import type { ManifestEntry } from '../src/revision/index';

/** 合并只看 blockId+hash，用假 hash 直接捏清单即可覆盖全矩阵。 */
function m(...pairs: Array<[string, string]>): ManifestEntry[] {
  return pairs.map(([blockId, hash]) => ({ blockId, hash }));
}

describe('merge/threeWayMerge 快进', () => {
  it('双方未动：base==ours==theirs → 快进 theirs（判定顺序在先），entries 等于 base', () => {
    const base = m(['A', 'h1'], ['B', 'h2']);
    const result = threeWayMerge(base, m(['A', 'h1'], ['B', 'h2']), m(['A', 'h1'], ['B', 'h2']));
    expect(result).toEqual<MergeResult>({
      entries: m(['A', 'h1'], ['B', 'h2']),
      conflicts: [],
      fastForward: 'theirs',
    });
  });

  it('仅 ours 前移（修改+新增）→ 快进 ours，entries 即 ours', () => {
    const base = m(['A', 'h1'], ['B', 'h2']);
    const ours = m(['A', 'h1x'], ['B', 'h2'], ['C', 'h3']);
    const result = threeWayMerge(base, ours, m(['A', 'h1'], ['B', 'h2']));
    expect(result).toEqual<MergeResult>({ entries: ours, conflicts: [], fastForward: 'ours' });
    // 返回的是拷贝，不与入参共享引用
    expect(result.entries).not.toBe(ours);
    expect(result.entries[0]).not.toBe(ours[0]);
  });

  it('仅 theirs 前移 → 快进 theirs（建议合并最常见路径）', () => {
    const base = m(['A', 'h1'], ['B', 'h2']);
    const theirs = m(['B', 'h2'], ['A', 'h1y']);
    const result = threeWayMerge(base, m(['A', 'h1'], ['B', 'h2']), theirs);
    expect(result).toEqual<MergeResult>({ entries: theirs, conflicts: [], fastForward: 'theirs' });
  });

  it('manifest 等价含顺序：仅 ours 重排（同 id 同 hash 异序）也判快进 ours', () => {
    const base = m(['A', 'h1'], ['B', 'h2']);
    const ours = m(['B', 'h2'], ['A', 'h1']);
    const result = threeWayMerge(base, ours, m(['A', 'h1'], ['B', 'h2']));
    expect(result).toEqual<MergeResult>({ entries: ours, conflicts: [], fastForward: 'ours' });
  });
});

describe('merge/threeWayMerge 逐块裁决', () => {
  it('双侧同改同一块（殊途同归）→ 取之，无冲突', () => {
    const base = m(['A', 'h1'], ['B', 'h2']);
    const result = threeWayMerge(base, m(['A', 'h1x'], ['B', 'h2']), m(['A', 'h1x'], ['B', 'h2']));
    expect(result).toEqual<MergeResult>({
      entries: m(['A', 'h1x'], ['B', 'h2']),
      conflicts: [],
      fastForward: null,
    });
  });

  it('双侧异改 → 冲突，entries 保留 ours 版本占位', () => {
    const base = m(['A', 'h1'], ['B', 'h2']);
    const result = threeWayMerge(
      base,
      m(['A', 'hOurs'], ['B', 'h2']),
      m(['A', 'hTheirs'], ['B', 'h2']),
    );
    expect(result).toEqual<MergeResult>({
      entries: m(['A', 'hOurs'], ['B', 'h2']),
      conflicts: [{ blockId: 'A', baseHash: 'h1', oursHash: 'hOurs', theirsHash: 'hTheirs' }],
      fastForward: null,
    });
  });

  it('我删他改 → 冲突（oursHash=null），entries 中不出现该块（ours 占位=不存在）', () => {
    const base = m(['A', 'h1'], ['B', 'h2']);
    const result = threeWayMerge(base, m(['B', 'h2']), m(['A', 'h1x'], ['B', 'h2']));
    expect(result).toEqual<MergeResult>({
      entries: m(['B', 'h2']),
      conflicts: [{ blockId: 'A', baseHash: 'h1', oursHash: null, theirsHash: 'h1x' }],
      fastForward: null,
    });
  });

  it('他删我改 → 冲突（theirsHash=null），entries 保留 ours 版本', () => {
    const base = m(['A', 'h1'], ['B', 'h2']);
    const result = threeWayMerge(base, m(['A', 'h1x'], ['B', 'h2']), m(['B', 'h2']));
    expect(result).toEqual<MergeResult>({
      entries: m(['A', 'h1x'], ['B', 'h2']),
      conflicts: [{ blockId: 'A', baseHash: 'h1', oursHash: 'h1x', theirsHash: null }],
      fastForward: null,
    });
  });

  it('双删 → 删，无冲突', () => {
    const base = m(['A', 'h1'], ['B', 'h2']);
    const result = threeWayMerge(base, m(['B', 'h2']), m(['B', 'h2']));
    expect(result).toEqual<MergeResult>({
      entries: m(['B', 'h2']),
      conflicts: [],
      fastForward: null,
    });
  });

  it('单侧删除而另一侧未动该块 → 删除生效（两个方向）', () => {
    const base = m(['A', 'h1'], ['B', 'h2']);
    // ours 删 A，theirs 只改 B
    expect(threeWayMerge(base, m(['B', 'h2']), m(['A', 'h1'], ['B', 'h2y']))).toEqual<MergeResult>({
      entries: m(['B', 'h2y']),
      conflicts: [],
      fastForward: null,
    });
    // theirs 删 A，ours 只改 B
    expect(threeWayMerge(base, m(['A', 'h1'], ['B', 'h2x']), m(['B', 'h2']))).toEqual<MergeResult>({
      entries: m(['B', 'h2x']),
      conflicts: [],
      fastForward: null,
    });
  });

  it('单侧增（ours）→ 保留，且不影响另一侧的变更', () => {
    const base = m(['A', 'h1']);
    const result = threeWayMerge(base, m(['A', 'h1'], ['N', 'hN']), m(['A', 'h1y']));
    expect(result).toEqual<MergeResult>({
      entries: m(['A', 'h1y'], ['N', 'hN']),
      conflicts: [],
      fastForward: null,
    });
  });

  it('双侧同位增同 hash → 取之一份，无冲突', () => {
    const base = m(['A', 'h1']);
    const result = threeWayMerge(base, m(['A', 'h1'], ['N', 'hN']), m(['A', 'h1'], ['N', 'hN']));
    expect(result).toEqual<MergeResult>({
      entries: m(['A', 'h1'], ['N', 'hN']),
      conflicts: [],
      fastForward: null,
    });
  });

  it('双侧增同 id 异 hash → 冲突且 baseHash=null', () => {
    const base = m(['A', 'h1']);
    const result = threeWayMerge(base, m(['A', 'h1'], ['N', 'hNo']), m(['A', 'h1'], ['N', 'hNt']));
    expect(result).toEqual<MergeResult>({
      entries: m(['A', 'h1'], ['N', 'hNo']),
      conflicts: [{ blockId: 'N', baseHash: null, oursHash: 'hNo', theirsHash: 'hNt' }],
      fastForward: null,
    });
  });

  it('移动对修改：ours 重排 + theirs 改内容 → ours 序 + theirs 内容，无冲突', () => {
    const base = m(['A', 'h1'], ['B', 'h2'], ['C', 'h3']);
    const ours = m(['C', 'h3'], ['A', 'h1'], ['B', 'h2']);
    const theirs = m(['A', 'h1'], ['B', 'h2y'], ['C', 'h3']);
    expect(threeWayMerge(base, ours, theirs)).toEqual<MergeResult>({
      entries: m(['C', 'h3'], ['A', 'h1'], ['B', 'h2y']),
      conflicts: [],
      fastForward: null,
    });
  });

  it('无冲突重排：双侧各动不同块（ours 重排+删，theirs 改）', () => {
    const base = m(['A', 'h1'], ['B', 'h2'], ['C', 'h3'], ['D', 'h4']);
    const ours = m(['D', 'h4'], ['A', 'h1'], ['C', 'h3']); // 删 B、D 提前
    const theirs = m(['A', 'h1'], ['B', 'h2'], ['C', 'h3y'], ['D', 'h4']); // 改 C
    expect(threeWayMerge(base, ours, theirs)).toEqual<MergeResult>({
      entries: m(['D', 'h4'], ['A', 'h1'], ['C', 'h3y']),
      conflicts: [],
      fastForward: null,
    });
  });
});

describe('merge/threeWayMerge theirs 新增块插入位置', () => {
  it('按 theirs 中的前驱锚块就近插入（ours 已重排时跟随锚块新位置）', () => {
    const base = m(['A', 'h1'], ['B', 'h2']);
    const ours = m(['B', 'h2'], ['A', 'h1']); // 重排
    const theirs = m(['A', 'h1'], ['X', 'hX'], ['B', 'h2']); // X 锚定 A 之后
    expect(threeWayMerge(base, ours, theirs)).toEqual<MergeResult>({
      entries: m(['B', 'h2'], ['A', 'h1'], ['X', 'hX']),
      conflicts: [],
      fastForward: null,
    });
  });

  it('前驱不存活则继续向前找下一个锚块', () => {
    const base = m(['A', 'h1'], ['B', 'h2'], ['C', 'h3']);
    const ours = m(['A', 'h1'], ['C', 'h3']); // 删 B
    const theirs = m(['A', 'h1'], ['B', 'h2'], ['X', 'hX'], ['C', 'h3']); // X 锚定 B 之后
    // B 被双方一致裁决为删除（ours 删、theirs 未改），X 向前回落到 A 之后
    expect(threeWayMerge(base, ours, theirs)).toEqual<MergeResult>({
      entries: m(['A', 'h1'], ['X', 'hX'], ['C', 'h3']),
      conflicts: [],
      fastForward: null,
    });
  });

  it('全部前驱不存活（或无前驱）→ 插开头', () => {
    const base = m(['A', 'h1'], ['B', 'h2']);
    const ours = m(['A', 'h1x'], ['B', 'h2']); // 改 A 避免快进
    const theirs = m(['X', 'hX'], ['A', 'h1'], ['B', 'h2']); // X 在 theirs 开头
    expect(threeWayMerge(base, ours, theirs)).toEqual<MergeResult>({
      entries: m(['X', 'hX'], ['A', 'h1x'], ['B', 'h2']),
      conflicts: [],
      fastForward: null,
    });
  });

  it('theirs 连续新增保持相对顺序（后增块锚定前增块）', () => {
    const base = m(['A', 'h1']);
    const ours = m(['A', 'h1x']);
    const theirs = m(['A', 'h1'], ['X', 'hX'], ['Y', 'hY']);
    expect(threeWayMerge(base, ours, theirs)).toEqual<MergeResult>({
      entries: m(['A', 'h1x'], ['X', 'hX'], ['Y', 'hY']),
      conflicts: [],
      fastForward: null,
    });
  });

  it('双方从空文档各自新增不同块：theirs 块无锚插开头，双方均保留', () => {
    const result = threeWayMerge([], m(['A', 'hA']), m(['B', 'hB']));
    expect(result).toEqual<MergeResult>({
      entries: m(['B', 'hB'], ['A', 'hA']),
      conflicts: [],
      fastForward: null,
    });
  });
});

describe('merge/threeWayMerge 组合', () => {
  it('多块混合：改/删/移/增/冲突并存，entries 与 conflicts 全量断言', () => {
    const base = m(['A', 'h1'], ['B', 'h2'], ['C', 'h3'], ['D', 'h4'], ['E', 'h5']);
    // ours：改 A、删 D、B 移到 C 后
    const ours = m(['A', 'h1a'], ['C', 'h3'], ['B', 'h2'], ['E', 'h5']);
    // theirs：改 B、改 D、D 后新增 N
    const theirs = m(
      ['A', 'h1'],
      ['B', 'h2b'],
      ['C', 'h3'],
      ['D', 'h4d'],
      ['N', 'hN'],
      ['E', 'h5'],
    );
    const result = threeWayMerge(base, ours, theirs);
    // D：我删他改 → 冲突，ours 占位=不存在；N 的前驱 D 不存活，回落到 C 之后
    expect(result).toEqual<MergeResult>({
      entries: m(['A', 'h1a'], ['C', 'h3'], ['N', 'hN'], ['B', 'h2b'], ['E', 'h5']),
      conflicts: [{ blockId: 'D', baseHash: 'h4', oursHash: null, theirsHash: 'h4d' }],
      fastForward: null,
    });
  });

  it('多个冲突按首次出现顺序（ours 序在先）记录', () => {
    const base = m(['A', 'h1'], ['B', 'h2']);
    const ours = m(['B', 'h2o'], ['A', 'h1o']);
    const theirs = m(['A', 'h1t'], ['B', 'h2t']);
    const result = threeWayMerge(base, ours, theirs);
    expect(result.entries).toEqual(m(['B', 'h2o'], ['A', 'h1o']));
    expect(result.conflicts).toEqual([
      { blockId: 'B', baseHash: 'h2', oursHash: 'h2o', theirsHash: 'h2t' },
      { blockId: 'A', baseHash: 'h1', oursHash: 'h1o', theirsHash: 'h1t' },
    ]);
    expect(result.fastForward).toBeNull();
  });
});
