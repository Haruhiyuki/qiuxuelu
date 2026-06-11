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

  it('kernel→Tiptap：highlight mark 为已知有损路径，往返后被剔除', () => {
    const doc: DocJson = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { blockId: 'p1' },
          content: [{ type: 'text', text: '高亮', marks: [{ type: 'highlight' }] }],
        },
      ],
    };
    const back = tiptapToKernel(kernelToTiptap(doc));
    const text = back.content[0]?.type === 'paragraph' ? back.content[0].content?.[0] : undefined;
    // highlight 被剥除：文本仍在，但不再带 marks
    expect(text).toEqual({ type: 'text', text: '高亮' });
  });

  it('空文档归一为单个空段落（PM doc 要求 min(1) 块）', () => {
    const tiptap = kernelToTiptap({ type: 'doc', content: [] });
    expect(tiptap.content?.[0]?.type).toBe('paragraph');
  });
});
