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

/** 跨块重映射输入：发布修订里每个块的纯文本（口径 = extractText）。 */
export interface BlockText {
  blockId: string;
  text: string;
}

export interface CrossRemapResult {
  blockId: string;
  startOffset: number;
  endOffset: number;
  state: AnchorState;
  /** 命中文本：调用方据此更新 quotedText，令锚点随文本演化收敛、不过早失锚。 */
  matchedText?: string;
  /** 命中时重算的前后文：刷新消歧上下文，避免多次编辑后上下文陈旧。 */
  prefix?: string;
  suffix?: string;
}

const CTX_LEN = 16;

function contextOf(text: string, start: number, end: number): { prefix?: string; suffix?: string } {
  const out: { prefix?: string; suffix?: string } = {};
  const prefix = text.slice(Math.max(0, start - CTX_LEN), start);
  const suffix = text.slice(end, Math.min(text.length, end + CTX_LEN));
  if (prefix.length > 0) out.prefix = prefix;
  if (suffix.length > 0) out.suffix = suffix;
  return out;
}

/**
 * 跨块锚点重映射（在 remapAnchor 之上再加一层「全文找回」）：最大化行内批注与修订的兼容。
 * 块被拆分/合并/删除使 blockId 消失，或引文被移出原块时，单块 remapAnchor 只会失锚；
 * 这里：
 *   先在「主块」(anchor.blockId) 内按原五级阶梯重映射——锚点优先黏在原块，避免被别处巧合吸走；
 *   主块不在、或主块内找不到，再在整篇所有块里找回：
 *     ① 全文唯一精确匹配 → 重映射到该块；
 *     ② 多处精确 → 前后文消歧（同分优先原块、再取离原偏移最近）；
 *     ③ 无精确 → 各块滑窗模糊匹配，取全局最优（Dice ≥ 阈值）；
 *     ④ 全失败 → orphaned（保留原 blockId 与引文，永不静默丢弃）。
 */
export function remapAnchorAcrossBlocks(
  anchor: Anchor & { blockId: string },
  blocks: readonly BlockText[],
): CrossRemapResult {
  const { quotedText, startOffset } = anchor;
  const orphan: CrossRemapResult = {
    blockId: anchor.blockId,
    startOffset: anchor.startOffset,
    endOffset: anchor.endOffset,
    state: 'orphaned',
  };
  if (quotedText.length === 0) {
    return orphan;
  }

  // 主块优先：原块还在就先在原块内重映射（命中即留原块，避免被别处重复文本巧合吸走）
  const home = blocks.find((b) => b.blockId === anchor.blockId);
  if (home !== undefined) {
    const r = remapAnchor(anchor, home.text);
    if (r.state !== 'orphaned') {
      return {
        blockId: anchor.blockId,
        startOffset: r.startOffset,
        endOffset: r.endOffset,
        state: r.state,
        matchedText: r.matchedText,
        ...contextOf(home.text, r.startOffset, r.endOffset),
      };
    }
  }

  // 全文精确匹配（跨块收集所有命中）
  const exact: { blockId: string; start: number; text: string }[] = [];
  for (const b of blocks) {
    for (const idx of collectExactMatches(b.text, quotedText)) {
      exact.push({ blockId: b.blockId, start: idx, text: b.text });
    }
  }
  if (exact.length >= 1) {
    let best = exact[0] as { blockId: string; start: number; text: string };
    if (exact.length > 1) {
      let bestScore = -1;
      for (const cand of exact) {
        const score = contextScore(anchor, cand.text, cand.start, cand.start + quotedText.length);
        const candHome = cand.blockId === anchor.blockId;
        const bestHome = best.blockId === anchor.blockId;
        // 同分消歧：优先原块；再取离原偏移最近
        const tie =
          score === bestScore &&
          ((candHome && !bestHome) ||
            (candHome === bestHome &&
              Math.abs(cand.start - startOffset) < Math.abs(best.start - startOffset)));
        if (score > bestScore || tie) {
          bestScore = score;
          best = cand;
        }
      }
    }
    const end = best.start + quotedText.length;
    return {
      blockId: best.blockId,
      startOffset: best.start,
      endOffset: end,
      state: 'remapped',
      matchedText: quotedText,
      ...contextOf(best.text, best.start, end),
    };
  }

  // 全文模糊匹配（各块滑窗，取全局最优）
  let fuzzy: { blockId: string; start: number; end: number; score: number; text: string } | null =
    null;
  for (const b of blocks) {
    const hit = fuzzyFind(quotedText, b.text, startOffset);
    if (hit !== null && (fuzzy === null || hit.score > fuzzy.score)) {
      fuzzy = {
        blockId: b.blockId,
        start: hit.start,
        end: hit.end,
        score: hit.score,
        text: b.text,
      };
    }
  }
  if (fuzzy !== null) {
    const start = snapToCodePoint(fuzzy.text, fuzzy.start, 'back');
    const end = snapToCodePoint(fuzzy.text, fuzzy.end, 'forward');
    return {
      blockId: fuzzy.blockId,
      startOffset: start,
      endOffset: end,
      state: 'remapped',
      matchedText: fuzzy.text.slice(start, end),
      ...contextOf(fuzzy.text, start, end),
    };
  }

  return orphan;
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
