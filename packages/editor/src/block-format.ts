// 块级排版扩展（ADR-0017）：给段落/标题加 textAlign + indent 属性，并把 Tab/Shift-Tab 绑成缩进增减。
// 不引第三方依赖；与 kernel schema v2 对齐（align 仅 center/right、indent 1–8，默认值省略保哈希稳定），
// 双向映射由 normalize 负责。列表里的 Tab 交还给列表扩展做层级缩进（sink/lift），互不抢键。
import { type Editor, Extension } from '@tiptap/core';

const FORMATTABLE = ['paragraph', 'heading'];
const MAX_INDENT = 8;

/** 调整当前段落/标题的缩进级（±1，夹在 0–MAX）。即使到边界也吞掉 Tab，避免焦点跳走或插入制表符。 */
function adjustIndent(editor: Editor, delta: number): boolean {
  const typeName = editor.state.selection.$from.parent.type.name;
  if (typeName !== 'paragraph' && typeName !== 'heading') {
    return false;
  }
  const raw = editor.state.selection.$from.parent.attrs.indent;
  const cur = typeof raw === 'number' ? raw : 0;
  const next = Math.max(0, Math.min(MAX_INDENT, cur + delta));
  if (next !== cur) {
    editor.chain().focus().updateAttributes(typeName, { indent: next }).run();
  }
  return true;
}

export const BlockFormatting = Extension.create({
  name: 'blockFormatting',

  addGlobalAttributes() {
    return [
      {
        types: FORMATTABLE,
        attributes: {
          // 文本对齐：仅 center/right 进 DOM（行内 style），left 视为默认不落属性
          textAlign: {
            default: null,
            parseHTML: (el) => {
              const v = el.style.textAlign;
              return v === 'center' || v === 'right' ? v : null;
            },
            renderHTML: (attrs) =>
              attrs.textAlign ? { style: `text-align: ${attrs.textAlign}` } : {},
          },
          // 缩进级（0 默认不落属性）：用 data-indent 承载，渲染端按级换算 padding
          indent: {
            default: 0,
            parseHTML: (el) => {
              const n = Number.parseInt(el.getAttribute('data-indent') ?? '0', 10);
              return Number.isFinite(n) && n > 0 ? Math.min(MAX_INDENT, n) : 0;
            },
            renderHTML: (attrs) =>
              typeof attrs.indent === 'number' && attrs.indent > 0
                ? { 'data-indent': String(attrs.indent) }
                : {},
          },
        },
      },
    ];
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        // 列表项里的 Tab 仍是层级缩进（交给 StarterKit 列表扩展）
        if (this.editor.isActive('listItem')) {
          return false;
        }
        return adjustIndent(this.editor, 1);
      },
      'Shift-Tab': () => {
        if (this.editor.isActive('listItem')) {
          return false;
        }
        return adjustIndent(this.editor, -1);
      },
    };
  },
});
