// 修复：光标停在「引用块 / 提示框 之后的空段」时，退格无法并入前面的块——
// ProseMirror 默认 joinBackward 在「空段紧跟 blockquote/callout」场景失效，表现为前面
// 引用块的内容再也删不动（光标卡在空段里，退格无反应）。
// 处理：删掉这个空段，把光标移进前一个容器块（引用/提示框）内容的末尾，使其可继续编辑/删除。
import { Extension } from '@tiptap/core';
import { Selection } from '@tiptap/pm/state';

const CONTAINER_BLOCKS = new Set(['blockquote', 'callout']);

export const BlockJoinBackspace = Extension.create({
  name: 'blockJoinBackspace',
  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { state, view } = editor;
        const { selection } = state;
        if (!selection.empty) {
          return false;
        }
        const { $from } = selection;
        // 仅处理：光标位于某「顶层文本块」的最前端
        if ($from.depth !== 1 || $from.parentOffset !== 0) {
          return false;
        }
        const cur = $from.parent;
        if (cur.content.size > 0) {
          return false; // 非空段交给默认退格行为（合并/删除字符）
        }
        const idx = $from.index(0);
        if (idx === 0) {
          return false;
        }
        const before = $from.node(0).child(idx - 1);
        if (!CONTAINER_BLOCKS.has(before.type.name)) {
          return false;
        }
        const curBefore = $from.before(1);
        const tr = state.tr.delete(curBefore, curBefore + cur.nodeSize);
        // 删除空段后，curBefore-1 落在前一个容器块的内部末尾；向前找最近的可放光标处
        const sel = Selection.findFrom(tr.doc.resolve(curBefore - 1), -1, true);
        if (sel !== null) {
          tr.setSelection(sel);
        }
        view.dispatch(tr.scrollIntoView());
        return true;
      },
    };
  },
});
