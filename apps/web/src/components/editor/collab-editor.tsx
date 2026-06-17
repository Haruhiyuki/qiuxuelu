'use client';

import { kernelToTiptap, tiptapToKernel } from '@harublog/editor';
// 协作直编已发布文章的编辑器：从发布内容载入，单次「发布修改」即时生效（进巡查队列）。
// 复用与 DocumentEditor 相同的 Tiptap 内核与 normalize；不走 working_copy / 审批。
import type { DocJson } from '@harublog/kernel';
import { Alert, Button, Label, Textarea, useConfirm } from '@harublog/ui';
import { EditorContent, useEditor } from '@tiptap/react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { directEditPublished } from '@/server/actions/document';
import { createSuggestion } from '@/server/actions/suggestion';
import { BubbleToolbar } from './bubble-toolbar';
import { clientExtensions } from './client-extensions';
import { TableToolbar } from './table-toolbar';
import { EditorToolbar } from './toolbar';

export interface CollabEditorProps {
  docId: string;
  slug: string;
  title: string;
  initialDoc: DocJson;
  /** collab=直接编辑发布版（即时生效+巡查）；suggest=提交修订申请（建分支，需审校合入）。 */
  mode?: 'collab' | 'suggest';
}

const COPY = {
  collab: {
    heading: '修订',
    intro:
      '你正在直接修订已发布的文章。保存后修改立即对所有读者可见，并进入巡查队列；权限者可一键撤回。',
    msgLabel: '修订说明（建议填写，便于巡查与回溯）',
    msgPlaceholder: '例如：修正了一处事实错误',
    confirm: '确认提交修订？修订会立即生效，并进入巡查队列接受复核。',
    submit: '提交修订',
    submitting: '提交中…',
  },
  suggest: {
    heading: '修订申请',
    intro:
      '你正在为这篇文章起草一份修订申请。提交后会生成一条修订分支，由权限者审核；通过后才会合入正文，全程留痕。',
    msgLabel: '申请说明（请说明你为什么这样改）',
    msgPlaceholder: '例如：第二段的年份有误，应为 2024',
    confirm: '确认提交这份修订申请？提交后将进入审核队列。',
    submit: '提交申请',
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
  const { confirm, confirmDialog } = useConfirm();

  const initialContent = useMemo(() => kernelToTiptap(initialDoc), [initialDoc]);

  const editor = useEditor({
    extensions: clientExtensions(),
    content: initialContent,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'prose-zh min-h-[55vh] px-6 py-6 focus:outline-none',
        'aria-label': '修订区',
      },
    },
  });

  const copy = COPY[mode];

  async function handleSubmit() {
    if (!editor) {
      return;
    }
    if (
      !(await confirm({
        title: copy.heading,
        description: copy.confirm,
        confirmLabel: copy.submit,
      }))
    ) {
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
      // 建议提交后跳到建议详情；修订跳回文章
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
      {confirmDialog}
      <header className="flex items-center gap-3">
        <h1 className="font-semibold font-serif text-ink-900 text-xl">
          {copy.heading}：{title}
        </h1>
      </header>
      <p className="text-ink-500 text-sm">{copy.intro}</p>

      {notice !== null ? (
        <Alert variant={notice.kind === 'info' ? 'info' : 'danger'}>{notice.text}</Alert>
      ) : null}

      {/* 工具栏作为本栏直接子节点：吸顶（sticky top-14，紧贴站点头）生效、自然取本栏宽度——
          与写文章页布局一致，不再被 overflow-hidden 容器困住、盖住正文。 */}
      {editor ? (
        <>
          <EditorToolbar editor={editor} />
          <BubbleToolbar editor={editor} />
          <TableToolbar editor={editor} />
          <EditorContent editor={editor} />
        </>
      ) : (
        <p className="py-16 text-ink-400 text-sm">编辑器加载中…</p>
      )}

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
