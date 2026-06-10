'use client';

import type { DocJson } from '@harublog/kernel';
import { Alert, Badge, Button, Label, Textarea } from '@harublog/ui';
import type { Editor } from '@tiptap/react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { docStatusLabel } from '@/lib/doc-labels';
import { commitRevision, requestPublish, saveWorkingCopy } from '@/server/actions/document';
import { BlockId } from './block-id';
import { kernelToTiptap, tiptapToKernel } from './normalize';
import { EditorToolbar } from './toolbar';

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const SAVE_STATE_TEXT: Record<SaveState, string> = {
  idle: '',
  dirty: '有未保存更改…',
  saving: '保存中…',
  saved: '已保存',
  error: '保存失败',
};

const STATUS_BADGE_VARIANT: Record<string, 'default' | 'brand' | 'accent' | 'outline'> = {
  draft: 'default',
  pending: 'accent',
  published: 'brand',
  archived: 'outline',
};

export interface DocumentEditorProps {
  docId: string;
  title: string;
  status: string;
  hasRevisions: boolean;
  headSeq: number | null;
  initialDoc: DocJson;
}

export function DocumentEditor(props: DocumentEditorProps) {
  const router = useRouter();
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [docStatus, setDocStatus] = useState(props.status);
  const [hasRevisions, setHasRevisions] = useState(props.hasRevisions);
  const [headSeq, setHeadSeq] = useState(props.headSeq);
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [actionPending, setActionPending] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'info' | 'danger'; text: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initialContent = useMemo(() => kernelToTiptap(props.initialDoc), [props.initialDoc]);

  const persist = useCallback(
    async (instance: Editor): Promise<boolean> => {
      setSaveState('saving');
      try {
        const kernelDoc = tiptapToKernel(instance.getJSON());
        const result = await saveWorkingCopy(props.docId, kernelDoc);
        if (result.ok) {
          setSaveState('saved');
          setSaveError(null);
          return true;
        }
        setSaveState('error');
        setSaveError(result.error);
        return false;
      } catch (err) {
        setSaveState('error');
        setSaveError(err instanceof Error ? err.message : '保存失败，请检查网络后重试');
        return false;
      }
    },
    [props.docId],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // 正文层级收敛为 2-4（h1 留给文章标题字段）
        heading: { levels: [2, 3, 4] },
        // kernel schema 没有 underline mark，关闭以免产出无法保存的内容
        underline: false,
        link: { openOnClick: false },
      }),
      BlockId,
    ],
    content: initialContent,
    // Next SSR：跳过服务端渲染，避免水合不一致
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'prose-zh min-h-[55vh] px-6 py-6 focus:outline-none',
        'aria-label': '正文编辑区',
      },
    },
    onUpdate: ({ editor: instance }) => {
      setSaveState('dirty');
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      // 2 秒防抖自动保存工作副本
      timerRef.current = setTimeout(() => {
        void persist(instance);
      }, 2000);
    },
  });

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  async function flushSave(): Promise<boolean> {
    if (!editor) {
      return false;
    }
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (saveState === 'idle' || saveState === 'saved') {
      return true;
    }
    return persist(editor);
  }

  async function handleCommit() {
    setActionPending(true);
    setNotice(null);
    try {
      const saved = await flushSave();
      if (!saved) {
        setNotice({ kind: 'danger', text: '草稿保存失败，已取消提交，请重试' });
        return;
      }
      const result = await commitRevision(props.docId, commitMessage);
      if (result.ok) {
        setCommitOpen(false);
        setCommitMessage('');
        setHasRevisions(true);
        setHeadSeq(result.data.seq);
        setNotice({ kind: 'info', text: `已提交第 ${result.data.seq} 号修订` });
        router.refresh();
      } else {
        setNotice({ kind: 'danger', text: result.error });
      }
    } finally {
      setActionPending(false);
    }
  }

  async function handleRequestPublish() {
    if (!window.confirm('确认申请发布？提交后将进入审校队列，期间无法再次申请。')) {
      return;
    }
    setActionPending(true);
    setNotice(null);
    try {
      const result = await requestPublish(props.docId);
      if (result.ok) {
        setDocStatus('pending');
        setNotice({ kind: 'info', text: '已提交发布申请，审校通过后文章将公开可见' });
        router.refresh();
      } else {
        setNotice({ kind: 'danger', text: result.error });
      }
    } finally {
      setActionPending(false);
    }
  }

  const canRequestPublish = docStatus === 'draft' && hasRevisions && !actionPending;
  const saveText = SAVE_STATE_TEXT[saveState];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="font-serif text-xl font-semibold text-ink-900">{props.title}</h1>
          <Badge variant={STATUS_BADGE_VARIANT[docStatus] ?? 'default'}>
            {docStatusLabel(docStatus)}
          </Badge>
          {headSeq !== null ? (
            <span className="text-xs text-ink-500">当前第 {headSeq} 号修订</span>
          ) : null}
        </div>
        <span
          className={saveState === 'error' ? 'text-sm text-accent-700' : 'text-sm text-ink-500'}
          aria-live="polite"
        >
          {saveState === 'error' && saveError !== null ? `${saveText}：${saveError}` : saveText}
        </span>
      </header>

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
          <p className="px-6 py-10 text-sm text-ink-500">编辑器加载中…</p>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-3">
        <Button onClick={() => setCommitOpen((open) => !open)} disabled={actionPending || !editor}>
          提交修订
        </Button>
        <Button variant="secondary" onClick={handleRequestPublish} disabled={!canRequestPublish}>
          申请发布
        </Button>
        {docStatus === 'pending' ? (
          <span className="text-sm text-ink-500">发布申请审核中，可继续修改并提交新修订</span>
        ) : null}
        {!hasRevisions ? (
          <span className="text-sm text-ink-500">提交第一个修订后才能申请发布</span>
        ) : null}
      </footer>

      {commitOpen ? (
        <section className="flex flex-col gap-3 rounded-sm border border-ink-200 bg-paper-50 p-4">
          <Label htmlFor="commit-message">修订说明（可选，便于历史回溯）</Label>
          <Textarea
            id="commit-message"
            rows={3}
            maxLength={500}
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            placeholder="例如：补充了选科建议一节"
          />
          <div className="flex items-center gap-3">
            <Button onClick={handleCommit} disabled={actionPending}>
              {actionPending ? '提交中…' : '确认提交'}
            </Button>
            <Button variant="ghost" onClick={() => setCommitOpen(false)} disabled={actionPending}>
              取消
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
