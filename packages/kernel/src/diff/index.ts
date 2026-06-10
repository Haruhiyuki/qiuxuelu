import { diffManifests, type ManifestEntry } from '../revision/index';
import { type DiffSegment, diffChars } from '../textdiff/index';

/** 修订 diff 的单块输入：块身份 + 内容哈希 + 类型 + 纯文本（由调用方用 extractText 抽取）。 */
export interface DiffBlockInput {
  blockId: string;
  hash: string;
  type: string;
  text: string;
}

/**
 * 显示用的修订 diff 条目。以 after（新版）的块顺序为主轴展示：
 * added/modified/moved/unchanged 按新版位置排列，removed（旧版有、新版无）单列。
 */
export type RevisionDiffEntry =
  | { kind: 'added'; blockId: string; type: string; pos: number; text: string }
  | { kind: 'removed'; blockId: string; type: string; oldPos: number; text: string }
  | {
      kind: 'modified';
      blockId: string;
      type: string;
      oldPos: number;
      pos: number;
      segments: DiffSegment[];
    }
  | { kind: 'moved'; blockId: string; type: string; oldPos: number; pos: number; text: string }
  | { kind: 'unchanged'; blockId: string; type: string; pos: number; text: string };

export interface RevisionDiff {
  /** 按新版块顺序排列：新增 / 修改 / 移动 / 未变。 */
  blocks: RevisionDiffEntry[];
  /** 旧版有、新版已删除的块（单列展示，保留原文）。 */
  removed: Extract<RevisionDiffEntry, { kind: 'removed' }>[];
  stats: { added: number; removed: number; modified: number; moved: number; unchanged: number };
}

/**
 * 构建两个修订之间的块级 diff 模型（纯函数）。
 * move/modify/add/remove 的判定复用 diffManifests（LIS 最小化移动），
 * modified 块再做字符级 diffChars；以新版顺序组织便于「带上下文阅读改动」。
 */
export function buildRevisionDiff(before: DiffBlockInput[], after: DiffBlockInput[]): RevisionDiff {
  const beforeEntries: ManifestEntry[] = before.map((b) => ({ blockId: b.blockId, hash: b.hash }));
  const afterEntries: ManifestEntry[] = after.map((b) => ({ blockId: b.blockId, hash: b.hash }));
  const beforeById = new Map(before.map((b) => [b.blockId, b]));

  const changes = diffManifests(beforeEntries, afterEntries);
  const changeByBlock = new Map(changes.map((c) => [c.blockId, c]));

  const blocks: RevisionDiffEntry[] = [];
  const stats = { added: 0, removed: 0, modified: 0, moved: 0, unchanged: 0 };

  after.forEach((block, pos) => {
    const change = changeByBlock.get(block.blockId);
    if (change === undefined) {
      blocks.push({
        kind: 'unchanged',
        blockId: block.blockId,
        type: block.type,
        pos,
        text: block.text,
      });
      stats.unchanged++;
      return;
    }
    switch (change.kind) {
      case 'add':
        blocks.push({
          kind: 'added',
          blockId: block.blockId,
          type: block.type,
          pos,
          text: block.text,
        });
        stats.added++;
        break;
      case 'modify': {
        const oldText = beforeById.get(block.blockId)?.text ?? '';
        blocks.push({
          kind: 'modified',
          blockId: block.blockId,
          type: block.type,
          oldPos: change.oldPos,
          pos,
          segments: diffChars(oldText, block.text),
        });
        stats.modified++;
        break;
      }
      case 'move':
        blocks.push({
          kind: 'moved',
          blockId: block.blockId,
          type: block.type,
          oldPos: change.oldPos,
          pos,
          text: block.text,
        });
        stats.moved++;
        break;
      case 'remove':
        // remove 不会出现在 after 中，理论不可达；为穷尽性保留
        break;
    }
  });

  const removed = changes
    .filter((c): c is Extract<typeof c, { kind: 'remove' }> => c.kind === 'remove')
    .map((c) => {
      const block = beforeById.get(c.blockId);
      stats.removed++;
      return {
        kind: 'removed' as const,
        blockId: c.blockId,
        type: block?.type ?? 'paragraph',
        oldPos: c.oldPos,
        text: block?.text ?? '',
      };
    });

  return { blocks, removed, stats };
}
