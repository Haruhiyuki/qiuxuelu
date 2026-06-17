'use client';

// 编辑工具栏：图标按钮分组（标题/行内/块/插入/历史），sticky 吸顶。
// 文字标签全部换成 lucide 图标 + title 提示，靠拢现代编辑器观感。
import { cn, usePrompt, useToast } from '@harublog/ui';
import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Code2,
  Heading2,
  Heading3,
  Heading4,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Sigma,
  Strikethrough,
  Table as TableIcon,
  Undo2,
} from 'lucide-react';
import { type ReactNode, useRef } from 'react';
import { uploadImageFile } from './upload';

function ToolbarButton({
  title,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      // onMouseDown + preventDefault：点工具栏不抢走编辑器选区
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors',
        active
          ? 'bg-brand-100 text-brand-800'
          : 'text-ink-500 hover:bg-paper-200 hover:text-ink-800',
        'disabled:pointer-events-none disabled:opacity-30',
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span aria-hidden className="mx-1 h-5 w-px shrink-0 self-center bg-ink-200" />;
}

const ICON = 'h-4 w-4';

export function EditorToolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      h4: e.isActive('heading', { level: 4 }),
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      highlight: e.isActive('highlight'),
      code: e.isActive('code'),
      link: e.isActive('link'),
      alignCenter:
        e.isActive('paragraph', { textAlign: 'center' }) ||
        e.isActive('heading', { textAlign: 'center' }),
      alignRight:
        e.isActive('paragraph', { textAlign: 'right' }) ||
        e.isActive('heading', { textAlign: 'right' }),
      blockquote: e.isActive('blockquote'),
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      codeBlock: e.isActive('codeBlock'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { prompt, promptDialog } = usePrompt();
  const toast = useToast();

  async function handleImagePick(file: File) {
    const uploaded = await uploadImageFile(file);
    if (uploaded === null) {
      toast('图片上传失败，请重试', 'error');
      return;
    }
    editor
      .chain()
      .focus()
      .insertContent({ type: 'figure', attrs: { src: uploaded.url, alt: '', caption: '' } })
      .run();
  }

  // 对齐作用于当前段落/标题；left 视为默认（清空属性）。两类型各调一次，仅命中当前块的生效。
  function setAlign(align: 'left' | 'center' | 'right') {
    const val = align === 'left' ? null : align;
    editor
      .chain()
      .focus()
      .updateAttributes('paragraph', { textAlign: val })
      .updateAttributes('heading', { textAlign: val })
      .run();
  }

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
    // 与 renderer 的 URL 安全门一致：可执行 scheme 在编辑入口就挡掉
    if (!/^(https?:\/\/|mailto:|\/|#)/i.test(href)) {
      toast('仅支持 http(s)、mailto 或站内路径链接', 'error');
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  }

  return (
    <div
      role="toolbar"
      aria-label="编辑工具栏"
      // 移动端单行横滑（no-scrollbar）避免多行换行挤压；桌面端（md+）放开自动换行
      className="no-scrollbar sticky top-14 z-20 flex flex-nowrap items-center gap-0.5 overflow-x-auto border-ink-200 border-b bg-paper-50/95 px-2 py-1.5 backdrop-blur-sm md:flex-wrap md:justify-center md:overflow-x-visible"
    >
      {promptDialog}
      <ToolbarButton
        title="小节标题（二级）"
        active={state.h2}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 className={ICON} />
      </ToolbarButton>
      <ToolbarButton
        title="小节标题（三级）"
        active={state.h3}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 className={ICON} />
      </ToolbarButton>
      <ToolbarButton
        title="小节标题（四级）"
        active={state.h4}
        onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
      >
        <Heading4 className={ICON} />
      </ToolbarButton>
      <Divider />
      <ToolbarButton
        title="左对齐"
        active={!state.alignCenter && !state.alignRight}
        onClick={() => setAlign('left')}
      >
        <AlignLeft className={ICON} />
      </ToolbarButton>
      <ToolbarButton title="居中对齐" active={state.alignCenter} onClick={() => setAlign('center')}>
        <AlignCenter className={ICON} />
      </ToolbarButton>
      <ToolbarButton title="右对齐" active={state.alignRight} onClick={() => setAlign('right')}>
        <AlignRight className={ICON} />
      </ToolbarButton>
      <Divider />
      <ToolbarButton
        title="加粗"
        active={state.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className={ICON} />
      </ToolbarButton>
      <ToolbarButton
        title="斜体"
        active={state.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className={ICON} />
      </ToolbarButton>
      <ToolbarButton
        title="删除线"
        active={state.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className={ICON} />
      </ToolbarButton>
      <ToolbarButton
        title="行内代码"
        active={state.code}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code className={ICON} />
      </ToolbarButton>
      <ToolbarButton
        title="高亮"
        active={state.highlight}
        onClick={() => editor.chain().focus().toggleHighlight().run()}
      >
        <Highlighter className={ICON} />
      </ToolbarButton>
      <ToolbarButton
        title={state.link ? '移除链接' : '插入链接'}
        active={state.link}
        onClick={handleLink}
      >
        <Link2 className={ICON} />
      </ToolbarButton>
      <Divider />
      <ToolbarButton
        title="引用块"
        active={state.blockquote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote className={ICON} />
      </ToolbarButton>
      <ToolbarButton
        title="无序列表"
        active={state.bulletList}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className={ICON} />
      </ToolbarButton>
      <ToolbarButton
        title="有序列表"
        active={state.orderedList}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className={ICON} />
      </ToolbarButton>
      <ToolbarButton
        title="代码块"
        active={state.codeBlock}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <Code2 className={ICON} />
      </ToolbarButton>
      <Divider />
      <ToolbarButton title="插入图片" onClick={() => fileInputRef.current?.click()}>
        <ImageIcon className={ICON} />
      </ToolbarButton>
      <ToolbarButton
        title="插入表格（3×3）"
        onClick={() =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: false }).run()
        }
      >
        <TableIcon className={ICON} />
      </ToolbarButton>
      <ToolbarButton
        title="插入提示框"
        onClick={() =>
          editor
            .chain()
            .focus()
            .insertContent({
              type: 'callout',
              attrs: { variant: 'info' },
              content: [{ type: 'paragraph' }],
            })
            .run()
        }
      >
        <span className="font-serif text-[15px] leading-none">!</span>
      </ToolbarButton>
      <ToolbarButton
        title="插入公式"
        onClick={() =>
          editor
            .chain()
            .focus()
            .insertContent({ type: 'mathBlock', attrs: { latex: '' } })
            .run()
        }
      >
        <Sigma className={ICON} />
      </ToolbarButton>
      <ToolbarButton
        title="分隔线"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        <Minus className={ICON} />
      </ToolbarButton>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            void handleImagePick(file);
          }
          e.target.value = '';
        }}
      />
      <Divider />
      <ToolbarButton
        title="撤销"
        disabled={!state.canUndo}
        onClick={() => editor.chain().focus().undo().run()}
      >
        <Undo2 className={ICON} />
      </ToolbarButton>
      <ToolbarButton
        title="重做"
        disabled={!state.canRedo}
        onClick={() => editor.chain().focus().redo().run()}
      >
        <Redo2 className={ICON} />
      </ToolbarButton>
    </div>
  );
}
