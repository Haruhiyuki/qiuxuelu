import { describe, expect, it } from 'vitest';
import type { DocJson } from '../src/schema/index';
import { SCHEMA_VERSION, validateDoc } from '../src/schema/index';

const fullDoc: DocJson = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { blockId: 'b-h', level: 2 },
      content: [{ type: 'text', text: '初三那年' }],
    },
    {
      type: 'paragraph',
      attrs: { blockId: 'b-p' },
      content: [
        { type: 'text', text: '加粗', marks: [{ type: 'bold' }] },
        { type: 'hard_break' },
        {
          type: 'text',
          text: '链接',
          marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
        },
      ],
    },
    {
      type: 'blockquote',
      attrs: { blockId: 'b-q' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '引用一段话' }] }],
    },
    {
      type: 'bullet_list',
      attrs: { blockId: 'b-ul' },
      content: [
        {
          type: 'list_item',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '要点' }] }],
        },
      ],
    },
    {
      type: 'ordered_list',
      attrs: { blockId: 'b-ol' },
      content: [
        {
          type: 'list_item',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一' }] }],
        },
      ],
    },
    {
      type: 'code_block',
      attrs: { blockId: 'b-c', language: 'ts' },
      content: [{ type: 'text', text: 'const x = 1;' }],
    },
    {
      type: 'figure',
      attrs: { blockId: 'b-f', src: '/img/a.png', alt: '校门', caption: '母校正门' },
    },
    {
      type: 'table',
      attrs: { blockId: 'b-t' },
      content: [
        {
          type: 'table_row',
          content: [
            { type: 'table_cell', content: [{ type: 'text', text: '科目' }] },
            { type: 'table_cell', content: [{ type: 'text', text: '分数' }] },
          ],
        },
      ],
    },
    {
      type: 'callout',
      attrs: { blockId: 'b-co', variant: 'tip' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '提示内容' }] }],
    },
    { type: 'divider', attrs: { blockId: 'b-d' } },
    { type: 'math_block', attrs: { blockId: 'b-m', latex: 'a^2+b^2=c^2' } },
  ],
};

describe('schema/validateDoc', () => {
  it('版本号锁定为 1', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  it('接受覆盖全部节点类型的文档并原样返回数据', () => {
    const parsed = validateDoc(structuredClone(fullDoc));
    expect(parsed).toEqual(fullDoc);
  });

  it('拒绝缺少 blockId 的顶层块', () => {
    const bad = { type: 'doc', content: [{ type: 'paragraph', attrs: {}, content: [] }] };
    expect(() => validateDoc(bad)).toThrowError(/文档校验失败/);
  });

  it('拒绝非法 heading 层级（仅 2|3|4）', () => {
    const bad = {
      type: 'doc',
      content: [{ type: 'heading', attrs: { blockId: 'h', level: 1 }, content: [] }],
    };
    expect(() => validateDoc(bad)).toThrowError(/文档校验失败/);
  });

  it('拒绝未知节点类型', () => {
    const bad = { type: 'doc', content: [{ type: 'iframe', attrs: { blockId: 'x' } }] };
    expect(() => validateDoc(bad)).toThrowError(/文档校验失败/);
  });

  it('拒绝重复 blockId（全文档唯一不变式）', () => {
    const bad = {
      type: 'doc',
      content: [
        { type: 'divider', attrs: { blockId: 'dup' } },
        { type: 'paragraph', attrs: { blockId: 'dup' }, content: [{ type: 'text', text: 'x' }] },
      ],
    };
    expect(() => validateDoc(bad)).toThrowError(/blockId 重复/);
  });

  it('拒绝空 marks 数组（保护哈希唯一形态）', () => {
    const bad = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { blockId: 'p' },
          content: [{ type: 'text', text: 'x', marks: [] }],
        },
      ],
    };
    expect(() => validateDoc(bad)).toThrowError(/文档校验失败/);
  });

  it('拒绝 code_block 中带 marks 的 text', () => {
    const bad = {
      type: 'doc',
      content: [
        {
          type: 'code_block',
          attrs: { blockId: 'c' },
          content: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }] }],
        },
      ],
    };
    expect(() => validateDoc(bad)).toThrowError(/文档校验失败/);
  });
});
