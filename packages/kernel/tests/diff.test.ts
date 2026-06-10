import { describe, expect, it } from 'vitest';
import { buildRevisionDiff, type DiffBlockInput } from '../src/diff/index';

function blk(blockId: string, hash: string, text: string, type = 'paragraph'): DiffBlockInput {
  return { blockId, hash, type, text };
}

describe('diff/buildRevisionDiff', () => {
  it('无变化：全部 unchanged', () => {
    const before = [blk('a', 'h1', '第一段'), blk('b', 'h2', '第二段')];
    const after = [blk('a', 'h1', '第一段'), blk('b', 'h2', '第二段')];
    const d = buildRevisionDiff(before, after);
    expect(d.stats).toEqual({ added: 0, removed: 0, modified: 0, moved: 0, unchanged: 2 });
    expect(d.blocks.every((b) => b.kind === 'unchanged')).toBe(true);
    expect(d.removed).toHaveLength(0);
  });

  it('新增块：after 多出的块标 added', () => {
    const before = [blk('a', 'h1', '第一段')];
    const after = [blk('a', 'h1', '第一段'), blk('b', 'h2', '新增段')];
    const d = buildRevisionDiff(before, after);
    expect(d.stats.added).toBe(1);
    expect(d.blocks[1]).toMatchObject({ kind: 'added', blockId: 'b', pos: 1, text: '新增段' });
  });

  it('删除块：before 有、after 无 → 进 removed 列', () => {
    const before = [blk('a', 'h1', '第一段'), blk('b', 'h2', '将被删')];
    const after = [blk('a', 'h1', '第一段')];
    const d = buildRevisionDiff(before, after);
    expect(d.stats.removed).toBe(1);
    expect(d.removed[0]).toMatchObject({
      kind: 'removed',
      blockId: 'b',
      oldPos: 1,
      text: '将被删',
    });
  });

  it('修改块：同 blockId 异 hash → modified 且带字符级 segments', () => {
    const before = [blk('a', 'h1', '高考前夜')];
    const after = [blk('a', 'h2', '高考前夕')];
    const d = buildRevisionDiff(before, after);
    expect(d.stats.modified).toBe(1);
    const entry = d.blocks[0];
    expect(entry?.kind).toBe('modified');
    if (entry?.kind === 'modified') {
      expect(entry.oldPos).toBe(0);
      expect(entry.segments.some((s) => s.op === 'delete' && s.text === '夜')).toBe(true);
      expect(entry.segments.some((s) => s.op === 'insert' && s.text === '夕')).toBe(true);
    }
  });

  it('移动块：内容不变但顺序变（LIS 最小化）→ moved', () => {
    const before = [blk('a', 'h1', 'A'), blk('b', 'h2', 'B'), blk('c', 'h3', 'C')];
    // 把 A 移到末尾：[B,C,A]，LIS=[B,C]，A 记 move
    const after = [blk('b', 'h2', 'B'), blk('c', 'h3', 'C'), blk('a', 'h1', 'A')];
    const d = buildRevisionDiff(before, after);
    expect(d.stats.moved).toBe(1);
    const moved = d.blocks.find((b) => b.kind === 'moved');
    expect(moved).toMatchObject({ kind: 'moved', blockId: 'a', oldPos: 0, pos: 2 });
    expect(d.stats.unchanged).toBe(2);
  });

  it('混合：新增+修改+删除并存，stats 准确', () => {
    const before = [blk('a', 'h1', '段一'), blk('b', 'h2', '段二原'), blk('c', 'h3', '段三')];
    const after = [blk('a', 'h1', '段一'), blk('b', 'h2b', '段二改'), blk('d', 'h4', '段四新')];
    const d = buildRevisionDiff(before, after);
    expect(d.stats).toMatchObject({ added: 1, removed: 1, modified: 1, unchanged: 1 });
    expect(d.removed.map((r) => r.blockId)).toEqual(['c']);
  });
});
