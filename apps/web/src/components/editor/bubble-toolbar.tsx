'use client';

// 选区气泡菜单：选中文字时浮出，做行内格式（粗/斜/删/码/高亮/链接）。现代编辑器标志交互。
import { cn } from '@harublog/ui';
import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';

function Btn({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={cn(
        'h-7 min-w-7 rounded-sm px-1.5 text-sm',
        active ? 'bg-brand-600 text-paper-50' : 'text-paper-100 hover:bg-ink-700',
      )}
    >
      {children}
    </button>
  );
}

export function BubbleToolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      highlight: e.isActive('highlight'),
      link: e.isActive('link'),
    }),
  });

  function handleLink() {
    if (state.link) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const href = window.prompt('链接地址（https:// 或站内路径）');
    if (href === null || href.trim().length === 0) {
      return;
    }
    if (!/^(https?:\/\/|mailto:|\/|#)/i.test(href.trim())) {
      window.alert('仅支持 http(s)、mailto 或站内路径链接');
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
  }

  return (
    <BubbleMenu
      editor={editor}
      // 仅在文本选区（非图片/数学等节点选区）出现
      shouldShow={({ editor: e, from, to }) =>
        from !== to && !e.isActive('figure') && !e.isActive('mathBlock')
      }
    >
      <div className="flex items-center gap-0.5 rounded-sm bg-ink-800 px-1 py-1 shadow-lg">
        <Btn
          title="加粗"
          active={state.bold}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <strong>B</strong>
        </Btn>
        <Btn
          title="斜体"
          active={state.italic}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <em>I</em>
        </Btn>
        <Btn
          title="删除线"
          active={state.strike}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <s>S</s>
        </Btn>
        <Btn
          title="行内代码"
          active={state.code}
          onClick={() => editor.chain().focus().toggleCode().run()}
        >
          {'<>'}
        </Btn>
        <Btn
          title="高亮"
          active={state.highlight}
          onClick={() => editor.chain().focus().toggleHighlight().run()}
        >
          <mark>高</mark>
        </Btn>
        <Btn title={state.link ? '移除链接' : '插入链接'} active={state.link} onClick={handleLink}>
          链接
        </Btn>
      </div>
    </BubbleMenu>
  );
}
