'use client';

import { kernelToTiptap, tiptapToKernel } from '@harublog/editor';
// 协作直编已发布文章的编辑器：从发布内容载入，单次「发布修改」即时生效（进巡查队列）。
// 复用与 DocumentEditor 相同的 Tiptap 内核与 normalize；不走 working_copy / 审批。
import type { DocJson } from '@harublog/kernel';
import { Alert, Button, Label, Textarea } from '@harublog/ui';
import { EditorContent, useEditor } from '@tiptap/react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { directEditPublished } from '@/server/actions/document';
import { createSuggestion } from '@/server/actions/suggestion';
import { BubbleToolbar } from './bubble-toolbar';
import { clientExtensions } from './client-extensions';
import { EditorToolbar } from './toolbar';

export interface CollabEditorProps {
  docId: string;
  slug: string;
  title: string;
  initialDoc: DocJson;
  /** collab=直接编辑发布版（即时生效+巡查）；suggest=提交编辑建议（建分支，需审校合入）。 */
  mode?: 'collab' | 'suggest';
}

const COPY = {
  collab: {
    heading: '协作编辑',
    intro:
      '你正在直接编辑已发布的文章。保存后修改立即对所有读者可见，并进入巡查队列；若被判定为劣化，巡查员可一键回退。',
    msgLabel: '修改说明（建议填写，便于巡查与回溯）',
    msgPlaceholder: '例如：修正了一处事实错误',
    confirm: '确认发布修改？协作编辑会立即生效，并进入巡查队列接受复核。',
    submit: '发布修改',
    submitting: '发布中…',
  },
  suggest: {
    heading: '提出编辑建议',
    intro:
      '你正在为这篇文章起草一份编辑建议。提交后会生成一条建议分支，由作者或编辑审校；采纳后才会合入正文，全程留痕。',
    msgLabel: '建议说明（请说明你为什么这样改）',
    msgPlaceholder: '例如：第二段的年份有误，应为 2024',
    confirm: '确认提交这份编辑建议？提交后将进入审校队列。',
    submit: '提交建议',
    submitting: '提交中…',
  },
} as const;

export function CollabEditor({
  docId,
  slug,
  title,
  initialDoc,
  mode = 'collab',
}: CollabEditorProps) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'info' | 'danger'; text: string } | null>(null);

  const initialContent = useMemo(() => kernelToTiptap(initialDoc), [initialDoc]);

  const editor = useEditor({
    extensions: clientExtensions(),
    content: initialContent,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'prose-zh min-h-[55vh] px-6 py-6 focus:outline-none',
        'aria-label': '协作编辑区',
      },
    },
  });

  const copy = COPY[mode];

  async function handleSubmit() {
    if (!editor) {
      return;
    }
    if (!window.confirm(copy.confirm)) {
      return;
    }
    setPending(true);
    setNotice(null);
    const kernelDoc = tiptapToKernel(editor.getJSON());
    const result =
      mode === 'suggest'
        ? await createSuggestion(docId, kernelDoc, message)
        : await directEditPublished(docId, kernelDoc, message);
    if (result.ok) {
      // 建议提交后跳到建议详情；协作编辑跳回文章
      const target =
        mode === 'suggest' && 'data' in result && result.data && 'suggestionId' in result.data
          ? `/suggestions/${(result.data as { suggestionId: string }).suggestionId}`
          : `/a/${slug}`;
      router.push(target);
      router.refresh();
    } else {
      setNotice({ kind: 'danger', text: result.error });
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-3">
        <h1 className="font-semibold font-serif text-ink-900 text-xl">
          {copy.heading}：{title}
        </h1>
      </header>
      <p className="text-ink-500 text-sm">{copy.intro}</p>

      {notice !== null ? (
        <Alert variant={notice.kind === 'info' ? 'info' : 'danger'}>{notice.text}</Alert>
      ) : null}

      <div className="overflow-hidden rounded-sm border border-ink-200 bg-paper-50">
        {editor ? (
          <>
            <EditorToolbar editor={editor} />
            <BubbleToolbar editor={editor} />
            <EditorContent editor={editor} />
          </>
        ) : (
          <p className="px-6 py-10 text-ink-500 text-sm">编辑器加载中…</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="collab-message">{copy.msgLabel}</Label>
        <Textarea
          id="collab-message"
          rows={2}
          maxLength={500}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={copy.msgPlaceholder}
        />
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={handleSubmit} disabled={pending || !editor}>
          {pending ? copy.submitting : copy.submit}
        </Button>
        <Button variant="ghost" onClick={() => router.push(`/a/${slug}`)} disabled={pending}>
          取消
        </Button>
      </div>
    </div>
  );
}
