// 斜杠命令扩展：输入 “/” 弹出块插入菜单（现代编辑器标志交互）。
// 基于 @tiptap/suggestion；弹层用 React 根挂到 body 并按光标定位，键盘 ↑↓/Enter/Esc 导航。
import { type Editor, Extension, type Range } from '@tiptap/core';
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SlashMenu } from './slash-menu';

export interface SlashItem {
  title: string;
  hint: string;
  run: (editor: Editor, range: Range) => void;
}

const ITEMS: SlashItem[] = [
  {
    title: '标题 2',
    hint: '小节标题',
    run: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 2 }).run(),
  },
  {
    title: '标题 3',
    hint: '子小节标题',
    run: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 3 }).run(),
  },
  {
    title: '标题 4',
    hint: '更小的标题',
    run: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 4 }).run(),
  },
  {
    title: '无序列表',
    hint: '要点罗列',
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run(),
  },
  {
    title: '有序列表',
    hint: '步骤编号',
    run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run(),
  },
  {
    title: '引用',
    hint: '引用一段话',
    run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run(),
  },
  {
    title: '代码块',
    hint: '展示代码',
    run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run(),
  },
  {
    title: '提示框',
    hint: '信息/技巧/注意/警告',
    run: (e, r) =>
      e
        .chain()
        .focus()
        .deleteRange(r)
        .insertContent({
          type: 'callout',
          attrs: { variant: 'info' },
          content: [{ type: 'paragraph' }],
        })
        .run(),
  },
  {
    title: '表格',
    hint: '3×3 表格',
    run: (e, r) =>
      e
        .chain()
        .focus()
        .deleteRange(r)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: false })
        .run(),
  },
  {
    title: '公式',
    hint: 'LaTeX 数学块',
    run: (e, r) =>
      e
        .chain()
        .focus()
        .deleteRange(r)
        .insertContent({ type: 'mathBlock', attrs: { latex: '' } })
        .run(),
  },
  {
    title: '分隔线',
    hint: '水平分隔',
    run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run(),
  },
];

function filterItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) {
    return ITEMS;
  }
  return ITEMS.filter((i) => i.title.toLowerCase().includes(q) || i.hint.includes(query));
}

function createRenderer() {
  let root: Root | null = null;
  let el: HTMLDivElement | null = null;
  let items: SlashItem[] = [];
  let selected = 0;
  let onPick: ((item: SlashItem) => void) | null = null;

  const draw = () => {
    root?.render(
      createElement(SlashMenu, {
        items,
        selectedIndex: selected,
        onSelect: (i: number) => {
          const item = items[i];
          if (item) {
            onPick?.(item);
          }
        },
      }),
    );
  };
  const place = (rect: DOMRect | null) => {
    if (el === null || rect === null) {
      return;
    }
    el.style.left = `${rect.left + window.scrollX}px`;
    el.style.top = `${rect.bottom + window.scrollY + 6}px`;
  };

  return {
    onStart(props: SuggestionProps<SlashItem>) {
      items = props.items;
      selected = 0;
      onPick = (item) => props.command(item);
      el = document.createElement('div');
      el.style.position = 'absolute';
      el.style.zIndex = '50';
      document.body.appendChild(el);
      root = createRoot(el);
      draw();
      place(props.clientRect?.() ?? null);
    },
    onUpdate(props: SuggestionProps<SlashItem>) {
      items = props.items;
      selected = 0;
      onPick = (item) => props.command(item);
      draw();
      place(props.clientRect?.() ?? null);
    },
    onKeyDown(props: SuggestionKeyDownProps) {
      const n = items.length;
      if (props.event.key === 'ArrowDown') {
        selected = n > 0 ? (selected + 1) % n : 0;
        draw();
        return true;
      }
      if (props.event.key === 'ArrowUp') {
        selected = n > 0 ? (selected - 1 + n) % n : 0;
        draw();
        return true;
      }
      if (props.event.key === 'Enter') {
        const item = items[selected];
        if (item) {
          onPick?.(item);
        }
        return true;
      }
      return props.event.key === 'Escape';
    },
    onExit() {
      root?.unmount();
      el?.remove();
      root = null;
      el = null;
    },
  };
}

export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: '/',
        allowSpaces: false,
        startOfLine: false,
        items: ({ query }) => filterItems(query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: createRenderer,
      }),
    ];
  },
});
