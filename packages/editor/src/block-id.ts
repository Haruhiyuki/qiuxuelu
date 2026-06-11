// 块身份的编辑器侧防线（架构 §6）：给全部顶层块注册 blockId 全局属性，
// 并用 appendTransaction 插件给「缺失或重复」的 blockId 补发 nanoid。
// 粘贴会原样复制 ID——查重重发是必须的，否则同文档出现同名块，kernel 提交侧会拒绝。
import { Extension } from '@tiptap/core';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { nanoid } from 'nanoid';

/** 与 StarterKit 配置对齐的全部顶层块类型；新增节点类型必须同步加进来，否则该类型块没有身份。 */
const TOP_BLOCK_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'codeBlock',
  'horizontalRule',
  'figure',
];

/**
 * 扫描顶层块，给缺失/重复的 blockId 补发新 id。
 * 去重规则：文档序第一个占有者保留原 id，其后的重复者换新——粘贴到后方的常见路径下
 * 原块身份不受影响；粘贴到前方时身份会让渡给粘贴块，这是位置启发式的已知边界。
 */
function ensureBlockIds(state: EditorState): Transaction | null {
  const seen = new Set<string>();
  let tr: Transaction | null = null;
  state.doc.forEach((node, offset) => {
    if (!('blockId' in node.attrs)) {
      return;
    }
    const id = node.attrs.blockId;
    if (typeof id === 'string' && id.length > 0 && !seen.has(id)) {
      seen.add(id);
      return;
    }
    const fresh = nanoid();
    tr ??= state.tr;
    // 仅改 attrs 不动内容，前面已记录的 offset 不会因此偏移
    tr.setNodeMarkup(offset, undefined, { ...node.attrs, blockId: fresh });
    seen.add(fresh);
  });
  return tr;
}

export const BlockId = Extension.create({
  name: 'blockId',

  addGlobalAttributes() {
    return [
      {
        types: TOP_BLOCK_TYPES,
        attributes: {
          blockId: {
            default: null,
            // 分裂时新半块不继承 id（由插件补发新 id），原块保留身份
            keepOnSplit: false,
            parseHTML: (element) => element.getAttribute('data-block-id'),
            renderHTML: (attributes) =>
              typeof attributes.blockId === 'string' && attributes.blockId.length > 0
                ? { 'data-block-id': attributes.blockId }
                : {},
          },
        },
      },
    ];
  },

  // 初始内容（含空文档的首个空段落）在任何编辑发生前就要有身份，appendTransaction 覆盖不到这一拍
  onCreate() {
    const tr = ensureBlockIds(this.editor.state);
    if (tr !== null) {
      this.editor.view.dispatch(tr);
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('blockIdGuard'),
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((transaction) => transaction.docChanged)) {
            return null;
          }
          return ensureBlockIds(newState);
        },
      }),
    ];
  },
});
