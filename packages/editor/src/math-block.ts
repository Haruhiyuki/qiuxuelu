// 数学块（对齐 kernel math_block：atom，attrs latex；blockId 由全局属性注入）。
// 仅 schema + HTML 序列化；latex 编辑/预览 NodeView 在 web 层挂载。
import { mergeAttributes, Node } from '@tiptap/core';

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return { latex: { default: '' } };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-math]',
        getAttrs: (el) => ({ latex: el.getAttribute('data-math') ?? '' }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const latex = typeof node.attrs.latex === 'string' ? node.attrs.latex : '';
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-math': latex, class: 'math-block' }),
      latex,
    ];
  },
});
