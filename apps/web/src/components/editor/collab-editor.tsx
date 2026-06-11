'use client';

// 协作直编已发布文章的编辑器：从发布内容载入，单次「发布修改」即时生效（进巡查队列）。
// 复用与 DocumentEditor 相同的 Tiptap 内核与 normalize；不走 working_copy / 审批。
import type { DocJson } from '@harublog/kernel';
import { Alert, Button, Label, Textarea } from '@harublog/ui';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { directEditPublished } from '@/server/actions/document';
import { BlockId } from './block-id';
import { kernelToTiptap, tiptapToKernel } from './normalize';
import { EditorToolbar } from './toolbar';

export interface CollabEditorProps {
  docId: string;
  slug: string;
  title: string;
  initialDoc: DocJson;
}

export function CollabEditor({ docId, slug, title, initialDoc }: CollabEditorProps) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'info' | 'danger'; text: string } | null>(null);

  const initialContent = useMemo(() => kernelToTiptap(initialDoc), [initialDoc]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        underline: false,
        link: { openOnClick: false },
      }),
      BlockId,
    ],
    content: initialContent,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'prose-zh min-h-[55vh] px-6 py-6 focus:outline-none',
        'aria-label': '协作编辑区',
      },
    },
  });

  async function handleSubmit() {
    if (!editor) {
      return;
    }
    if (!window.confirm('确认发布修改？协作编辑会立即生效，并进入巡查队列接受复核。')) {
      return;
    }
    setPending(true);
    setNotice(null);
    const kernelDoc = tiptapToKernel(editor.getJSON());
    const result = await directEditPublished(docId, kernelDoc, message);
    if (result.ok) {
      router.push(`/a/${slug}`);
      router.refresh();
    } else {
      setNotice({ kind: 'danger', text: result.error });
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3">
        <h1 className="font-semibold font-serif text-ink-900 text-xl">协作编辑：{title}</h1>
      </header>
      <p className="text-ink-500 text-sm">
        你正在直接编辑已发布的文章。保存后修改立即对所有读者可见，并进入巡查队列；若被判定为劣化，巡查员可一键回退。
      </p>

      {notice !== null ? (
        <Alert variant={notice.kind === 'info' ? 'info' : 'danger'}>{notice.text}</Alert>
      ) : null}

      <div className="overflow-hidden rounded-sm border border-ink-200 bg-paper-50">
        {editor ? (
          <>
            <EditorToolbar editor={editor} />
            <EditorContent editor={editor} />
          </>
        ) : (
          <p className="px-6 py-10 text-ink-500 text-sm">编辑器加载中…</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="collab-message">修改说明（建议填写，便于巡查与回溯）</Label>
        <Textarea
          id="collab-message"
          rows={2}
          maxLength={500}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="例如：修正了一处事实错误"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={handleSubmit} disabled={pending || !editor}>
          {pending ? '发布中…' : '发布修改'}
        </Button>
        <Button variant="ghost" onClick={() => router.push(`/a/${slug}`)} disabled={pending}>
          取消
        </Button>
      </div>
    </div>
  );
}
