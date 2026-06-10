import type { ManifestEntry } from '../revision/index';

/** 三方合并冲突描述；某侧为 null 表示该侧已删除此块。 */
export interface MergeConflict {
  blockId: string;
  baseHash: string | null;
  oursHash: string | null;
  theirsHash: string | null;
}

export interface MergeResult {
  entries: ManifestEntry[];
  conflicts: MergeConflict[];
  fastForward: 'ours' | 'theirs' | null;
}

/** manifest 等价 = 同序、同 blockId、同 hash（快进判定的依据）。 */
function manifestsEqual(a: ManifestEntry[], b: ManifestEntry[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((entry, i) => {
    const other = b[i] as ManifestEntry;
    return entry.blockId === other.blockId && entry.hash === other.hash;
  });
}

function toHashMap(entries: ManifestEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of entries) map.set(entry.blockId, entry.hash);
  return map;
}

/**
 * 三方块级合并（ADR-0004 §3.3）。冲突原子单位是块。
 *
 * 逐块裁决规则：
 * - 单侧变更（含删除）取变更侧；
 * - 两侧同 hash（殊途同归）取之；双删即删；
 * - 两侧异 hash、一侧删除另一侧修改 → 记入 conflicts。
 *
 * 冲突占位语义：冲突块在 entries 中保留 ours 版本占位（ours 已删则不出现在 entries），
 * 调用方必须依据 conflicts 走 UI 逐块裁决后再落盘——entries 本身不是终局结果。
 *
 * 块序：以 ours 序为准；theirs 新增块按其在 theirs 中的前驱锚块就近插入
 * （前驱在结果中不存活则继续向前找，全部不存活则插开头）。
 *
 * 快进：base==ours → 'theirs'；base==theirs → 'ours'（manifest 等价比较），此时 conflicts 恒为空。
 *
 * conflicts 顺序：按 blockId 首次出现顺序（先 ours 序、再 theirs 序、最后 base 序）。
 *
 * 扩展点（M3）：两侧异 hash 时可先取双方 blob 做 diff3 字符级辅助合并，
 * 自动合并成功则消解冲突；本期刻意不做，冲突直接交 UI 裁决。
 */
export function threeWayMerge(
  base: ManifestEntry[],
  ours: ManifestEntry[],
  theirs: ManifestEntry[],
): MergeResult {
  if (manifestsEqual(base, ours)) {
    return { entries: theirs.map((entry) => ({ ...entry })), conflicts: [], fastForward: 'theirs' };
  }
  if (manifestsEqual(base, theirs)) {
    return { entries: ours.map((entry) => ({ ...entry })), conflicts: [], fastForward: 'ours' };
  }

  const baseMap = toHashMap(base);
  const oursMap = toHashMap(ours);
  const theirsMap = toHashMap(theirs);

  const conflicts: MergeConflict[] = [];
  // 裁决结果：hash 表示存活内容，null 表示删除
  const resolved = new Map<string, string | null>();

  const decide = (blockId: string): string | null => {
    const b = baseMap.get(blockId) ?? null;
    const o = oursMap.get(blockId) ?? null;
    const t = theirsMap.get(blockId) ?? null;
    if (o === b && t === b) return b;
    if (o === b) return t; // 仅 theirs 变更（含删除）
    if (t === b) return o; // 仅 ours 变更（含删除）
    if (o === t) return o; // 殊途同归 / 双删
    conflicts.push({ blockId, baseHash: b, oursHash: o, theirsHash: t });
    return o; // 冲突：以 ours 版本占位（o 为 null 时即不出现在 entries）
  };

  const seen = new Set<string>();
  for (const entry of [...ours, ...theirs, ...base]) {
    if (seen.has(entry.blockId)) continue;
    seen.add(entry.blockId);
    resolved.set(entry.blockId, decide(entry.blockId));
  }

  const entries: ManifestEntry[] = [];
  for (const entry of ours) {
    const hash = resolved.get(entry.blockId);
    if (hash != null) entries.push({ blockId: entry.blockId, hash });
  }

  // theirs 新增块插入：在 theirs 中向前找最近的、在当前结果里存活的前驱锚块
  theirs.forEach((entry, i) => {
    if (oursMap.has(entry.blockId)) return;
    const hash = resolved.get(entry.blockId);
    if (hash == null) return;
    let insertAt = 0;
    for (let p = i - 1; p >= 0; p--) {
      const anchorId = (theirs[p] as ManifestEntry).blockId;
      const anchorIndex = entries.findIndex((candidate) => candidate.blockId === anchorId);
      if (anchorIndex !== -1) {
        insertAt = anchorIndex + 1;
        break;
      }
    }
    entries.splice(insertAt, 0, { blockId: entry.blockId, hash });
  });

  return { entries, conflicts, fastForward: null };
}
