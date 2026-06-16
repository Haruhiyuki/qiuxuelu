// 斜杠菜单共享类型：独立成文件，断开 slash-command（扩展）↔ slash-menu（弹层 UI）的循环依赖。
import type { Editor, Range } from '@tiptap/core';

export interface SlashItem {
  title: string;
  hint: string;
  run: (editor: Editor, range: Range) => void;
}
