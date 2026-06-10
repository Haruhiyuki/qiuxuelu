/** 文本 diff 片段：相等 / 新增 / 删除。 */
export type DiffOp = 'equal' | 'insert' | 'delete';

export interface DiffSegment {
  op: DiffOp;
  text: string;
}

/** 超过此长度的文本不做精细 diff，退化为整体替换——块级文本通常远小于此，仅防御极端情况。 */
const COARSE_THRESHOLD = 4000;

/**
 * 字符级 diff（按 Unicode 码点切分，对中文友好）。
 * 基于最长公共子序列（LCS）回溯，产出最小化的 equal/insert/delete 片段序列。
 * before→after：delete 表示 before 中被删去，insert 表示 after 中新增。
 */
export function diffChars(before: string, after: string): DiffSegment[] {
  if (before === after) {
    return before.length === 0 ? [] : [{ op: 'equal', text: before }];
  }
  const a = Array.from(before);
  const b = Array.from(after);
  if (a.length === 0) {
    return [{ op: 'insert', text: after }];
  }
  if (b.length === 0) {
    return [{ op: 'delete', text: before }];
  }
  // 超长文本放弃精细 diff，避免 O(n·m) DP 爆炸（块级文本不会触达，纯防御）
  if (a.length > COARSE_THRESHOLD || b.length > COARSE_THRESHOLD) {
    return [
      { op: 'delete', text: before },
      { op: 'insert', text: after },
    ];
  }

  const n = a.length;
  const m = b.length;
  // lcs[i][j] = a[i:] 与 b[j:] 的 LCS 长度。?? 0 兜底越界，避免非空断言。
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const at = (i: number, j: number): number => lcs[i]?.[j] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    const row = lcs[i] ?? [];
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }

  const raw: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const ca = a[i] ?? '';
    const cb = b[j] ?? '';
    if (ca === cb) {
      raw.push({ op: 'equal', text: ca });
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      raw.push({ op: 'delete', text: ca });
      i++;
    } else {
      raw.push({ op: 'insert', text: cb });
      j++;
    }
  }
  while (i < n) {
    raw.push({ op: 'delete', text: a[i] ?? '' });
    i++;
  }
  while (j < m) {
    raw.push({ op: 'insert', text: b[j] ?? '' });
    j++;
  }

  // 合并相邻同类片段，减少渲染碎片
  const merged: DiffSegment[] = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last !== undefined && last.op === seg.op) {
      last.text += seg.text;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}
