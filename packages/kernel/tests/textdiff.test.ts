import { describe, expect, it } from 'vitest';
import { diffChars } from '../src/textdiff/index';

describe('textdiff/diffChars', () => {
  it('完全相同 → 单个 equal（空串返回空数组）', () => {
    expect(diffChars('高考加油', '高考加油')).toEqual([{ op: 'equal', text: '高考加油' }]);
    expect(diffChars('', '')).toEqual([]);
  });

  it('从空到有 → 单个 insert；从有到空 → 单个 delete', () => {
    expect(diffChars('', '新增内容')).toEqual([{ op: 'insert', text: '新增内容' }]);
    expect(diffChars('删除内容', '')).toEqual([{ op: 'delete', text: '删除内容' }]);
  });

  it('中间替换一段：保留公共前后缀，中段 delete+insert', () => {
    const segs = diffChars('那年高考前夜我彻夜难眠', '那年高考前夕我彻夜难眠');
    // 重建：equal 拼接 before、equal+insert 拼接 after 必须还原两侧原文
    const before = segs
      .filter((s) => s.op !== 'insert')
      .map((s) => s.text)
      .join('');
    const after = segs
      .filter((s) => s.op !== 'delete')
      .map((s) => s.text)
      .join('');
    expect(before).toBe('那年高考前夜我彻夜难眠');
    expect(after).toBe('那年高考前夕我彻夜难眠');
    // 公共前缀「那年高考前」与后缀「我彻夜难眠」应为 equal，仅「夜→夕」变化
    expect(segs.some((s) => s.op === 'delete' && s.text === '夜')).toBe(true);
    expect(segs.some((s) => s.op === 'insert' && s.text === '夕')).toBe(true);
  });

  it('纯追加：公共前缀 equal + 末尾 insert', () => {
    expect(diffChars('学习方法', '学习方法论')).toEqual([
      { op: 'equal', text: '学习方法' },
      { op: 'insert', text: '论' },
    ]);
  });

  it('码点安全：星平面字符（emoji）按整码点处理，不切碎', () => {
    const segs = diffChars('加油😀', '加油😀💪');
    expect(segs).toEqual([
      { op: 'equal', text: '加油😀' },
      { op: 'insert', text: '💪' },
    ]);
  });

  it('相邻同类片段被合并', () => {
    const segs = diffChars('abc', 'xyz');
    // 无公共子序列：一个 delete 段 + 一个 insert 段（已合并）
    expect(segs.filter((s) => s.op === 'delete')).toHaveLength(1);
    expect(segs.filter((s) => s.op === 'insert')).toHaveLength(1);
  });
});
