'use client';

// 选区气泡菜单：选中文字时浮出，做行内格式（粗/斜/删/码/高亮/链接）。现代编辑器标志交互。
import { cn, usePrompt, useToast } from '@harublog/ui';
import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Bold, Code, Highlighter, Italic, Link2, Strikethrough } from 'lucide-react';

const ICON = 'h-4 w-4';

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
      aria-label={title}
      aria-pressed={active}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-md transition-colors',
        active ? 'bg-fill text-on-fill' : 'text-on-overlay hover:bg-overlay-hover',
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

  const { prompt, promptDialog } = usePrompt();
  const toast = useToast();

  async function handleLink() {
    if (state.link) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const href = await prompt({
      title: '插入链接',
      label: '链接地址',
      placeholder: 'https:// 或 /站内路径',
      confirmLabel: '插入',
      required: true,
    });
    if (href === null || href.length === 0) {
      return;
    }
    if (!/^(https?:\/\/|mailto:|\/|#)/i.test(href)) {
      toast('仅支持 http(s)、mailto 或站内路径链接', 'error');
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  }

  return (
    <>
      {promptDialog}
      <BubbleMenu
        editor={editor}
        // 仅在文本选区（非图片/数学等节点选区）出现
        shouldShow={({ editor: e, from, to }) =>
          from !== to && !e.isActive('figure') && !e.isActive('mathBlock')
        }
      >
        <div className="pop-in flex items-center gap-0.5 rounded-lg bg-overlay px-1 py-1 shadow-float">
          <Btn
            title="加粗"
            active={state.bold}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold className={ICON} />
          </Btn>
          <Btn
            title="斜体"
            active={state.italic}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic className={ICON} />
          </Btn>
          <Btn
            title="删除线"
            active={state.strike}
            onClick={() => editor.chain().focus().toggleStrike().run()}
          >
            <Strikethrough className={ICON} />
          </Btn>
          <Btn
            title="行内代码"
            active={state.code}
            onClick={() => editor.chain().focus().toggleCode().run()}
          >
            <Code className={ICON} />
          </Btn>
          <Btn
            title="高亮"
            active={state.highlight}
            onClick={() => editor.chain().focus().toggleHighlight().run()}
          >
            <Highlighter className={ICON} />
          </Btn>
          <Btn
            title={state.link ? '移除链接' : '插入链接'}
            active={state.link}
            onClick={handleLink}
          >
            <Link2 className={ICON} />
          </Btn>
        </div>
      </BubbleMenu>
    </>
  );
}
