'use client';

// 近闻正文编辑器：直接复用博客编辑器内核（clientExtensions + 工具栏），产出 kernel DocJson 回传表单。
// 与撰写/协作直编同一套 schema 与 NodeView，富文本能力（标题/列表/引用/图片/表格/公式）一致。
import { kernelToTiptap, tiptapToKernel } from '@harublog/editor';
import type { DocJson } from '@harublog/kernel';
import { EditorContent, useEditor } from '@tiptap/react';
import { useMemo } from 'react';
import { BubbleToolbar } from '@/components/editor/bubble-toolbar';
import { clientExtensions } from '@/components/editor/client-extensions';
import { TableToolbar } from '@/components/editor/table-toolbar';
import { EditorToolbar } from '@/components/editor/toolbar';

export function AnnouncementBodyEditor({
  initialDoc,
  onChange,
}: {
  initialDoc: DocJson;
  // 每次编辑产出最新 DocJson，由表单持有；提交时直接发出去
  onChange: (doc: DocJson) => void;
}) {
  const initialContent = useMemo(() => kernelToTiptap(initialDoc), [initialDoc]);

  const editor = useEditor({
    extensions: clientExtensions({ placeholder: '正文：支持标题、列表、引用、图片、表格、公式……' }),
    content: initialContent,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'prose-zh min-h-[40vh] px-5 py-5 focus:outline-none',
        'aria-label': '近闻正文编辑区',
      },
    },
    onUpdate: ({ editor: instance }) => {
      onChange(tiptapToKernel(instance.getJSON()));
    },
  });

  return (
    <div className="overflow-hidden rounded-sm border border-ink-200 bg-paper-50">
      {editor ? (
        <>
          <EditorToolbar editor={editor} />
          <BubbleToolbar editor={editor} />
          <TableToolbar editor={editor} />
          <EditorContent editor={editor} />
        </>
      ) : (
        <p className="px-5 py-10 text-ink-500 text-sm">编辑器加载中…</p>
      )}
    </div>
  );
}
