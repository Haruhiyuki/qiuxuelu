// 图片块节点（对齐 kernel figure：atom 块，attrs src/alt/caption；blockId 由 BlockId 全局属性注入）。
// 仅定义 schema 与 HTML 序列化——React NodeView（行内编辑说明/alt）在 web 层 .extend 挂载，
// 保持本包 framework-light，且 collab/getEditorSchema 与 web 用同一份 schema。
import { mergeAttributes, Node } from '@tiptap/core';

export interface FigureOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const Figure = Node.create<FigureOptions>({
  name: 'figure',
  group: 'block',
  atom: true,
  draggable: true,
  isolating: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      src: { default: '' },
      alt: { default: '' },
      caption: { default: '' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure[data-block-id]',
        getAttrs: (el) => {
          const img = el.querySelector('img');
          const figcaption = el.querySelector('figcaption');
          return {
            src: img?.getAttribute('src') ?? '',
            alt: img?.getAttribute('alt') ?? '',
            caption: figcaption?.textContent ?? '',
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const caption = typeof node.attrs.caption === 'string' ? node.attrs.caption : '';
    const img = ['img', { src: node.attrs.src, alt: node.attrs.alt, loading: 'lazy' }];
    // HTMLAttributes 已含 BlockId 全局属性注入的 data-block-id
    return caption.length > 0
      ? [
          'figure',
          mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
          img,
          ['figcaption', caption],
        ]
      : ['figure', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), img];
  },
});
