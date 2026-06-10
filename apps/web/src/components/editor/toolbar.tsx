'use client';

import { cn } from '@harublog/ui';
import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import type { ReactNode } from 'react';

interface ToolbarButtonProps {
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function ToolbarButton({
  title,
  active = false,
  disabled = false,
  onClick,
  children,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'h-8 min-w-8 rounded-sm px-2 text-sm transition-colors',
        active ? 'bg-brand-100 font-medium text-brand-800' : 'text-ink-600 hover:bg-paper-200',
        'disabled:pointer-events-none disabled:opacity-40',
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span aria-hidden className="mx-1 h-5 w-px self-center bg-ink-200" />;
}

export function EditorToolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      paragraph: e.isActive('paragraph'),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      h4: e.isActive('heading', { level: 4 }),
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      link: e.isActive('link'),
      blockquote: e.isActive('blockquote'),
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      codeBlock: e.isActive('codeBlock'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  function handleLink() {
    if (state.link) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const href = window.prompt('链接地址（支持 https:// 或站内路径）');
    if (href === null || href.trim().length === 0) {
      return;
    }
    // 与 renderer 的 URL 安全门一致：可执行 scheme 在编辑入口就挡掉
    if (!/^(https?:\/\/|mailto:|\/|#)/i.test(href.trim())) {
      window.alert('仅支持 http(s)、mailto 或站内路径链接');
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
  }

  return (
    <div
      role="toolbar"
      aria-label="编辑工具栏"
      className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b border-ink-200 bg-paper-50 px-2 py-1.5"
    >
      <ToolbarButton
        title="正文段落"
        active={state.paragraph}
        onClick={() => editor.chain().focus().setParagraph().run()}
      >
        正文
      </ToolbarButton>
      <ToolbarButton
        title="小节标题（二级）"
        active={state.h2}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H2
      </ToolbarButton>
      <ToolbarButton
        title="小节标题（三级）"
        active={state.h3}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        H3
      </ToolbarButton>
      <ToolbarButton
        title="小节标题（四级）"
        active={state.h4}
        onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
      >
        H4
      </ToolbarButton>
      <Divider />
      <ToolbarButton
        title="加粗"
        active={state.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <strong>B</strong>
      </ToolbarButton>
      <ToolbarButton
        title="斜体"
        active={state.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <em>I</em>
      </ToolbarButton>
      <ToolbarButton
        title="删除线"
        active={state.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <s>S</s>
      </ToolbarButton>
      <ToolbarButton
        title="行内代码"
        active={state.code}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        {'<>'}
      </ToolbarButton>
      <ToolbarButton
        title={state.link ? '移除链接' : '插入链接'}
        active={state.link}
        onClick={handleLink}
      >
        链接
      </ToolbarButton>
      <Divider />
      <ToolbarButton
        title="引用块"
        active={state.blockquote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        引用
      </ToolbarButton>
      <ToolbarButton
        title="无序列表"
        active={state.bulletList}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        •列表
      </ToolbarButton>
      <ToolbarButton
        title="有序列表"
        active={state.orderedList}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        1.列表
      </ToolbarButton>
      <ToolbarButton
        title="代码块"
        active={state.codeBlock}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        代码块
      </ToolbarButton>
      <ToolbarButton
        title="分隔线"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        —
      </ToolbarButton>
      <Divider />
      <ToolbarButton
        title="撤销"
        disabled={!state.canUndo}
        onClick={() => editor.chain().focus().undo().run()}
      >
        撤销
      </ToolbarButton>
      <ToolbarButton
        title="重做"
        disabled={!state.canRedo}
        onClick={() => editor.chain().focus().redo().run()}
      >
        重做
      </ToolbarButton>
    </div>
  );
}
