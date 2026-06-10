/** 行内锚点：基于块内纯文本偏移 + 引文 + 前后文（架构 §3.4）。 */
export interface Anchor {
  startOffset: number;
  endOffset: number;
  quotedText: string;
  prefix?: string;
  suffix?: string;
}

export type AnchorState = 'live' | 'remapped' | 'orphaned';

export interface RemapResult {
  startOffset: number;
  endOffset: number;
  state: AnchorState;
  /**
   * remapped 时为新区间命中的实际文本。调用方应以它更新存储的 quotedText——
   * 否则相似度永远以最初引文为基准，文本多次小幅演化后锚点会过早失锚，
   * 且经模糊命中的锚点永远无法收敛回 live。
   */
  matchedText?: string;
}

/** 偏移落在代理对中间（低代理位）时收拢到码点边界，防止区间切进 emoji 内部。 */
function snapToCodePoint(text: string, offset: number, direction: 'back' | 'forward'): number {
  if (offset <= 0 || offset >= text.length) return offset;
  const code = text.charCodeAt(offset);
  const prev = text.charCodeAt(offset - 1);
  const splitsPair = code >= 0xdc00 && code <= 0xdfff && prev >= 0xd800 && prev <= 0xdbff;
  if (!splitsPair) return offset;
  return direction === 'back' ? offset - 1 : offset + 1;
}

/** Dice 系数下限：低于此值认为模糊匹配不可信，宁可失锚也不错贴。 */
const FUZZY_DICE_THRESHOLD = 0.75;

function collectExactMatches(text: string, needle: string): number[] {
  const matches: number[] = [];
  let from = 0;
  while (true) {
    const idx = text.indexOf(needle, from);
    if (idx === -1) break;
    matches.push(idx);
    from = idx + 1;
  }
  return matches;
}

/** 前后文吻合度：prefix 与候选位置前文的公共后缀长度 + suffix 与后文的公共前缀长度。 */
function contextScore(anchor: Anchor, text: string, start: number, end: number): number {
  let score = 0;
  const prefix = anchor.prefix ?? '';
  if (prefix.length > 0) {
    const before = text.slice(Math.max(0, start - prefix.length), start);
    let i = 0;
    while (
      i < before.length &&
      i < prefix.length &&
      before[before.length - 1 - i] === prefix[prefix.length - 1 - i]
    ) {
      i++;
    }
    score += i;
  }
  const suffix = anchor.suffix ?? '';
  if (suffix.length > 0) {
    const after = text.slice(end, end + suffix.length);
    let i = 0;
    while (i < after.length && i < suffix.length && after[i] === suffix[i]) {
      i++;
    }
    score += i;
  }
  return score;
}

/** 字符二元组多重集（中文无词边界，bigram 是最稳的相似度基元）。 */
function bigramCounts(s: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i + 1 < s.length; i++) {
    const gram = s.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

function diceCoefficient(
  a: Map<string, number>,
  aTotal: number,
  b: Map<string, number>,
  bTotal: number,
): number {
  if (aTotal === 0 || bTotal === 0) return 0;
  let common = 0;
  for (const [gram, countA] of a) {
    const countB = b.get(gram);
    if (countB !== undefined) common += Math.min(countA, countB);
  }
  return (2 * common) / (aTotal + bTotal);
}

interface FuzzyHit {
  start: number;
  end: number;
  score: number;
}

/**
 * 滑窗模糊匹配：窗长取引文长 ±20%，逐窗算 bigram Dice，达阈值取最优。
 * 同分时取离原 startOffset 最近的窗（锚点倾向于原位附近）。
 * 性能注：块级文本量级小（段落），O(n·len) 的朴素扫描足够；若未来吃紧可改滚动 bigram。
 */
function fuzzyFind(quoted: string, text: string, originStart: number): FuzzyHit | null {
  if (quoted.length < 2) return null; // 单字符无 bigram 可比
  const qCounts = bigramCounts(quoted);
  const qTotal = quoted.length - 1;
  const minLen = Math.max(2, Math.ceil(quoted.length * 0.8));
  const maxLen = Math.min(text.length, Math.floor(quoted.length * 1.2));
  let best: FuzzyHit | null = null;
  for (let len = minLen; len <= maxLen; len++) {
    for (let start = 0; start + len <= text.length; start++) {
      const window = text.slice(start, start + len);
      const score = diceCoefficient(qCounts, qTotal, bigramCounts(window), len - 1);
      if (score < FUZZY_DICE_THRESHOLD) continue;
      if (
        best === null ||
        score > best.score ||
        (score === best.score && Math.abs(start - originStart) < Math.abs(best.start - originStart))
      ) {
        best = { start, end: start + len, score };
      }
    }
  }
  return best;
}

/**
 * 锚点重映射五级阶梯：
 * ① 原偏移处即引文 → live；
 * ② 全文唯一精确匹配 → remapped；
 * ③ 多处匹配 → prefix/suffix 消歧（吻合度最高者；同分取离原位最近）→ remapped；
 * ④ 无精确匹配 → 滑窗模糊匹配（Dice ≥ 0.75）→ remapped；
 * ⑤ 全部失败 → orphaned（偏移返回原值，调用方按失锚处理、保留引文，永不静默丢弃）。
 */
export function remapAnchor(anchor: Anchor, newText: string): RemapResult {
  const { quotedText, startOffset, endOffset } = anchor;
  if (quotedText.length === 0) {
    return { startOffset, endOffset, state: 'orphaned' };
  }

  if (
    startOffset >= 0 &&
    startOffset <= newText.length &&
    newText.slice(startOffset, startOffset + quotedText.length) === quotedText &&
    endOffset === startOffset + quotedText.length
  ) {
    return { startOffset, endOffset, state: 'live', matchedText: quotedText };
  }

  const matches = collectExactMatches(newText, quotedText);
  if (matches.length === 1) {
    const start = matches[0] as number;
    return {
      startOffset: start,
      endOffset: start + quotedText.length,
      state: 'remapped',
      matchedText: quotedText,
    };
  }
  if (matches.length > 1) {
    let bestStart = matches[0] as number;
    let bestScore = -1;
    for (const start of matches) {
      const score = contextScore(anchor, newText, start, start + quotedText.length);
      const closerTie =
        score === bestScore && Math.abs(start - startOffset) < Math.abs(bestStart - startOffset);
      if (score > bestScore || closerTie) {
        bestScore = score;
        bestStart = start;
      }
    }
    return {
      startOffset: bestStart,
      endOffset: bestStart + quotedText.length,
      state: 'remapped',
      matchedText: quotedText,
    };
  }

  const fuzzy = fuzzyFind(quotedText, newText, startOffset);
  if (fuzzy !== null) {
    // 滑窗按 UTF-16 码元滑动，命中区间可能切进代理对（emoji 等星平面字符）内部，收拢到码点边界。
    const start = snapToCodePoint(newText, fuzzy.start, 'back');
    const end = snapToCodePoint(newText, fuzzy.end, 'forward');
    return {
      startOffset: start,
      endOffset: end,
      state: 'remapped',
      matchedText: newText.slice(start, end),
    };
  }

  return { startOffset, endOffset, state: 'orphaned' };
}

/**
 * 锚点构造辅助：截取引文与前后各 ctxLen 字符上下文。
 * 区间必须非空——空引文无法重映射，直接拒绝。
 */
export function makeAnchor(text: string, start: number, end: number, ctxLen = 16): Anchor {
  if (
    !(
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= 0 &&
      end > start &&
      end <= text.length
    )
  ) {
    throw new Error(`锚点区间非法：[${start}, ${end})，文本长度 ${text.length}`);
  }
  const anchor: Anchor = {
    startOffset: start,
    endOffset: end,
    quotedText: text.slice(start, end),
  };
  const prefix = text.slice(Math.max(0, start - ctxLen), start);
  const suffix = text.slice(end, Math.min(text.length, end + ctxLen));
  if (prefix.length > 0) anchor.prefix = prefix;
  if (suffix.length > 0) anchor.suffix = suffix;
  return anchor;
}
