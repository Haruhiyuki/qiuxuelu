// 提示框块（对齐 kernel callout：attrs variant∈{info,tip,warn,danger}，content 段落+；blockId 由全局属性注入）。
// 仅 schema + HTML 序列化；变体选择器 NodeView 在 web 层挂载。
import { mergeAttributes, Node } from '@tiptap/core';

export type CalloutVariant = 'info' | 'tip' | 'warn' | 'danger';

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'paragraph+',
  defining: true,

  addAttributes() {
    return { variant: { default: 'info' } };
  },

  parseHTML() {
    return [
      {
        tag: 'aside[data-callout]',
        getAttrs: (el) => ({ variant: el.getAttribute('data-callout') ?? 'info' }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const variant = typeof node.attrs.variant === 'string' ? node.attrs.variant : 'info';
    return [
      'aside',
      mergeAttributes(HTMLAttributes, {
        'data-callout': variant,
        class: `callout callout-${variant}`,
      }),
      0,
    ];
  },
});
