// 锁死 normalize 往返不变式（normalize.ts 注释里的可测性约定）：
// 对编辑器支持的 kernel 子集 K，tiptapToKernel(kernelToTiptap(K)) 深度等于 K。
// 这是 canonicalize 哈希稳定、块身份不漂移的前提。
import type { DocJson } from '@harublog/kernel';
import { describe, expect, it } from 'vitest';
import { kernelToTiptap, tiptapToKernel } from './normalize';

function roundTrip(doc: DocJson): DocJson {
  return tiptapToKernel(kernelToTiptap(doc));
}

describe('normalize 往返不变式', () => {
  it('覆盖全部支持块型与 mark 的文档往返不变', () => {
    const doc: DocJson = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { blockId: 'h1', level: 2 },
          content: [{ type: 'text', text: '标题' }],
        },
        {
          type: 'paragraph',
          attrs: { blockId: 'p1' },
          content: [
            { type: 'text', text: '粗', marks: [{ type: 'bold' }] },
            { type: 'text', text: '斜', marks: [{ type: 'italic' }] },
            { type: 'text', text: '码', marks: [{ type: 'code' }] },
            { type: 'text', text: '删', marks: [{ type: 'strikethrough' }] },
            {
              type: 'text',
              text: '链',
              marks: [{ type: 'link', attrs: { href: 'https://x.test/a' } }],
            },
            { type: 'hard_break' },
            { type: 'text', text: '末' },
          ],
        },
        {
          type: 'blockquote',
          attrs: { blockId: 'q1' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '引用' }] }],
        },
        {
          type: 'bullet_list',
          attrs: { blockId: 'ul1' },
          content: [
            {
              type: 'list_item',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '项' }] }],
            },
          ],
        },
        {
          type: 'ordered_list',
          attrs: { blockId: 'ol1' },
          content: [
            {
              type: 'list_item',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '一' }] }],
            },
          ],
        },
        {
          type: 'code_block',
          attrs: { blockId: 'c1', language: 'ts' },
          content: [{ type: 'text', text: 'const a = 1' }],
        },
        {
          type: 'code_block',
          attrs: { blockId: 'c2' },
          content: [{ type: 'text', text: 'plain' }],
        },
        { type: 'divider', attrs: { blockId: 'd1' } },
        { type: 'paragraph', attrs: { blockId: 'p2' } },
      ],
    };
    expect(roundTrip(doc)).toEqual(doc);
  });

  it('figure / table / callout / math_block / highlight 全部往返不变', () => {
    const doc: DocJson = {
      type: 'doc',
      content: [
        {
          type: 'figure',
          attrs: { blockId: 'f1', src: '/api/media/abc', alt: '示意图', caption: '图 1' },
        },
        { type: 'figure', attrs: { blockId: 'f2', src: '/api/media/def', alt: '' } },
        {
          type: 'callout',
          attrs: { blockId: 'co1', variant: 'warn' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '注意事项' }] }],
        },
        { type: 'math_block', attrs: { blockId: 'm1', latex: 'a^2 + b^2 = c^2' } },
        {
          type: 'table',
          attrs: { blockId: 't1' },
          content: [
            {
              type: 'table_row',
              content: [
                { type: 'table_cell', content: [{ type: 'text', text: '甲' }] },
                { type: 'table_cell' },
              ],
            },
            {
              type: 'table_row',
              content: [
                { type: 'table_cell', content: [{ type: 'text', text: '乙' }] },
                { type: 'table_cell', content: [{ type: 'text', text: '丙' }] },
              ],
            },
          ],
        },
        {
          type: 'paragraph',
          attrs: { blockId: 'p1' },
          content: [{ type: 'text', text: '重点', marks: [{ type: 'highlight' }] }],
        },
      ],
    };
    expect(roundTrip(doc)).toEqual(doc);
  });

  it('link mark 仅保留 href（剥除编辑器附属属性）', () => {
    const doc: DocJson = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { blockId: 'p1' },
          content: [
            {
              type: 'text',
              text: 'x',
              marks: [{ type: 'link', attrs: { href: 'https://x.test' } }],
            },
          ],
        },
      ],
    };
    expect(roundTrip(doc)).toEqual(doc);
  });

  it('表格 header 单元格归一为普通单元格（唯一有损点）', () => {
    const tiptap = {
      type: 'doc',
      content: [
        {
          type: 'table',
          attrs: { blockId: 't1' },
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: '表头' }] }],
                },
              ],
            },
          ],
        },
      ],
    };
    const kernel = tiptapToKernel(tiptap);
    const table = kernel.content[0];
    // header 落为普通 table_cell（kernel 无 header 概念），内容保留
    expect(table?.type).toBe('table');
    if (table?.type === 'table') {
      expect(table.content[0]?.content[0]).toEqual({
        type: 'table_cell',
        content: [{ type: 'text', text: '表头' }],
      });
    }
  });

  it('空文档归一为单个空段落（PM doc 要求 min(1) 块）', () => {
    const tiptap = kernelToTiptap({ type: 'doc', content: [] });
    expect(tiptap.content?.[0]?.type).toBe('paragraph');
  });

  it('段落/标题的 align/indent 往返不变（ADR-0017），普通块保持纯净', () => {
    const doc: DocJson = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { blockId: 'p1', align: 'center', indent: 2 },
          content: [{ type: 'text', text: '居中且缩进' }],
        },
        {
          type: 'heading',
          attrs: { blockId: 'h1', level: 3, align: 'right' },
          content: [{ type: 'text', text: '右对齐标题' }],
        },
        { type: 'paragraph', attrs: { blockId: 'p2' }, content: [{ type: 'text', text: '普通' }] },
      ],
    };
    expect(roundTrip(doc)).toEqual(doc);
  });
});
