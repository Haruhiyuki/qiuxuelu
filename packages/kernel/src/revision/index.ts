import { hashBlock, normalizeNfc, stripIdentity } from '../canon/index';
import type {
  BlockNode,
  CodeTextNode,
  DocJson,
  InlineNode,
  InnerParagraphNode,
  ListItemNode,
  TableCellNode,
  TableRowNode,
} from '../schema/index';

/** 修订树清单项：有序块清单的最小单元，对应 revision_blocks 一行。 */
export interface ManifestEntry {
  blockId: string;
  hash: string;
}

export type BlockChange =
  | { kind: 'add'; blockId: string; hash: string; pos: number }
  | { kind: 'remove'; blockId: string; oldHash: string; oldPos: number }
  | {
      kind: 'modify';
      blockId: string;
      oldHash: string;
      newHash: string;
      oldPos: number;
      pos: number;
    }
  | { kind: 'move'; blockId: string; hash: string; oldPos: number; pos: number };

/**
 * 由文档构建修订清单与内容寻址 blob 集。
 * blobs 以 hash 为键天然去重（同内容块只存一份），其中节点已 stripIdentity。
 */
export function buildManifest(doc: DocJson): {
  entries: ManifestEntry[];
  blobs: Map<string, BlockNode>;
} {
  const entries: ManifestEntry[] = [];
  const blobs = new Map<string, BlockNode>();
  for (const node of doc.content) {
    const hash = hashBlock(node);
    entries.push({ blockId: node.attrs.blockId, hash });
    if (!blobs.has(hash)) {
      // 入库形式必须与哈希输入同为 NFC，否则同哈希可对应不同字节（内容寻址不变式）。
      blobs.set(hash, normalizeNfc(stripIdentity(node)));
    }
  }
  return { entries, blobs };
}

/**
 * 严格递增最长子序列，返回入选元素的下标集合（patience 算法，O(n log n)）。
 * LIS 之外的元素即「相对顺序被打破」的元素。
 */
function lisIndexSet(seq: number[]): Set<number> {
  const tails: number[] = []; // tails[k] = 长度 k+1 的递增子序列中最小结尾值在 seq 中的下标
  const prev: number[] = new Array(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i++) {
    const value = seq[i] as number;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((seq[tails[mid] as number] as number) < value) lo = mid + 1;
      else hi = mid;
    }
    prev[i] = lo > 0 ? (tails[lo - 1] as number) : -1;
    tails[lo] = i;
  }
  const picked = new Set<number>();
  let cursor = tails.length > 0 ? (tails[tails.length - 1] as number) : -1;
  while (cursor !== -1) {
    picked.add(cursor);
    cursor = prev[cursor] as number;
  }
  return picked;
}

/**
 * 块级 diff。输出顺序固定：先按 base 位置升序输出全部 remove，再按 head 位置升序输出 add/modify/move。
 *
 * move 判定：只对「内容未变的共同块」按 base 位置序列求 LIS，不在 LIS 中者记 move——
 * 这保证 move 数最小（如 [A,B,C,D]→[B,C,D,A] 只产生 1 个 move）。
 * 内容已变的块一律记 modify（pos/oldPos 字段已表达移动），不重复发 move，
 * 也不参与 LIS——否则被修改块会把无辜的未修改块挤出 LIS、虚增 move。
 */
export function diffManifests(base: ManifestEntry[], head: ManifestEntry[]): BlockChange[] {
  const basePos = new Map<string, number>();
  base.forEach((entry, i) => {
    basePos.set(entry.blockId, i);
  });
  const headIds = new Set(head.map((entry) => entry.blockId));

  const changes: BlockChange[] = [];

  base.forEach((entry, oldPos) => {
    if (!headIds.has(entry.blockId)) {
      changes.push({ kind: 'remove', blockId: entry.blockId, oldHash: entry.hash, oldPos });
    }
  });

  // 未修改共同块（按 head 序）的 base 位置序列 → LIS
  const stableSeq: number[] = [];
  for (const entry of head) {
    const oldPos = basePos.get(entry.blockId);
    if (oldPos !== undefined && (base[oldPos] as ManifestEntry).hash === entry.hash) {
      stableSeq.push(oldPos);
    }
  }
  const lis = lisIndexSet(stableSeq);

  let stableIndex = 0;
  head.forEach((entry, pos) => {
    const oldPos = basePos.get(entry.blockId);
    if (oldPos === undefined) {
      changes.push({ kind: 'add', blockId: entry.blockId, hash: entry.hash, pos });
      return;
    }
    const oldHash = (base[oldPos] as ManifestEntry).hash;
    if (oldHash !== entry.hash) {
      changes.push({
        kind: 'modify',
        blockId: entry.blockId,
        oldHash,
        newHash: entry.hash,
        oldPos,
        pos,
      });
      return;
    }
    const inLis = lis.has(stableIndex);
    stableIndex++;
    if (!inLis) {
      changes.push({ kind: 'move', blockId: entry.blockId, hash: entry.hash, oldPos, pos });
    }
  });

  return changes;
}

export type ExtractableNode =
  | DocJson
  | BlockNode
  | InlineNode
  | InnerParagraphNode
  | ListItemNode
  | TableRowNode
  | TableCellNode
  | CodeTextNode;

/**
 * 中文场景纯文本抽取，供 diff 展示/搜索/锚点重映射共用。
 * 规则：行内节点直接拼接不加空格（中文无词间空格）；hard_break 记 '\n'；
 * 块级子单元（段落/列表项/表格行与单元格）一律以 '\n' 分隔；
 * figure 取 caption（缺省回落 alt）；math_block 取 latex 源码以便检索。
 */
export function extractText(node: ExtractableNode): string {
  switch (node.type) {
    case 'text':
      return node.text;
    case 'hard_break':
      return '\n';
    case 'paragraph':
    case 'heading':
    case 'table_cell':
      return (node.content ?? []).map(extractText).join('');
    case 'code_block':
      return (node.content ?? []).map((t) => t.text).join('');
    case 'figure':
      return node.attrs.caption ?? node.attrs.alt;
    case 'math_block':
      return node.attrs.latex;
    case 'divider':
      return '';
    case 'doc':
    case 'blockquote':
    case 'callout':
    case 'bullet_list':
    case 'ordered_list':
    case 'list_item':
    case 'table':
    case 'table_row':
      return node.content.map(extractText).join('\n');
    default: {
      const exhausted: never = node;
      return exhausted;
    }
  }
}

/**
 * 收集文档里所有 link mark 的 href（link 是 schema 中唯一带 href 的 mark）。
 * 纯函数、零 IO；对站内提及/外链统计、知识图谱提边等共用。href 语义（如 /a/<slug>）由调用方解释。
 */
export function collectLinkHrefs(doc: DocJson): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item);
      }
      return;
    }
    if (typeof node !== 'object' || node === null) {
      return;
    }
    const obj = node as Record<string, unknown>;
    const marks = obj.marks;
    if (Array.isArray(marks)) {
      for (const mark of marks) {
        if (
          typeof mark === 'object' &&
          mark !== null &&
          (mark as { type?: unknown }).type === 'link'
        ) {
          const href = (mark as { attrs?: { href?: unknown } }).attrs?.href;
          if (typeof href === 'string') {
            out.push(href);
          }
        }
      }
    }
    if (Array.isArray(obj.content)) {
      walk(obj.content);
    }
  };
  walk(doc);
  return out;
}
