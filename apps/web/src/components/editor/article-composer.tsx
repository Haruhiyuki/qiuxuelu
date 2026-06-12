'use client';

// 统一文章撰写器：标题 + 正文 + 发布设置一体（现代写作台范式，告别「先建后编」两段式）。
// 新建模式懒创建：首次真正编辑（标题/正文有内容）才落库，避免空草稿堆积；落库后静默把
// URL 换成 /write/[id]（刷新即进编辑模式）。所有改动随写随存（标题/板块/摘要走 updateDocumentMeta，
// 正文走 saveWorkingCopy，标签走 setDocumentTags）。提交修订 / 申请发布逻辑沿用既有动作。
import { kernelToTiptap, tiptapToKernel } from '@harublog/editor';
import type { DocJson } from '@harublog/kernel';
import { Alert, Badge, Button, Label, Textarea, useConfirm } from '@harublog/ui';
import type { Editor } from '@tiptap/react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Check, ChevronLeft, Loader2, Settings2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { docStatusLabel } from '@/lib/doc-labels';
import {
  commitRevision,
  createDocument,
  requestPublish,
  saveWorkingCopy,
  updateDocumentMeta,
} from '@/server/actions/document';
import { setDocumentTags } from '@/server/actions/tags';
import { BubbleToolbar } from './bubble-toolbar';
import { clientExtensions } from './client-extensions';
import { EditorToolbar } from './toolbar';

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const STATUS_BADGE_VARIANT: Record<string, 'default' | 'brand' | 'accent' | 'outline'> = {
  draft: 'default',
  pending: 'accent',
  published: 'brand',
  archived: 'outline',
};

export interface SectionOption {
  id: string;
  name: string;
}

export interface ArticleComposerProps {
  /** edit 模式必填；new 模式为 null（懒创建后填入） */
  docId: string | null;
  sections: SectionOption[];
  initialTitle: string;
  initialSectionId: string;
  initialSummary: string;
  initialTags: string[];
  initialDoc: DocJson;
  status: string;
  hasRevisions: boolean;
  headSeq: number | null;
}

const PLACEHOLDER_TITLE = '无标题';

export function ArticleComposer(props: ArticleComposerProps) {
  const router = useRouter();
  const [docId, setDocId] = useState<string | null>(props.docId);
  const [title, setTitle] = useState(props.initialTitle);
  const [sectionId, setSectionId] = useState(props.initialSectionId || props.sections[0]?.id || '');
  const [summary, setSummary] = useState(props.initialSummary);
  const [tags, setTags] = useState<string[]>(props.initialTags);
  const [tagDraft, setTagDraft] = useState('');
  const [docStatus, setDocStatus] = useState(props.status);
  const [hasRevisions, setHasRevisions] = useState(props.hasRevisions);
  const [headSeq, setHeadSeq] = useState(props.headSeq);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [panelOpen, setPanelOpen] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [actionPending, setActionPending] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'info' | 'danger'; text: string } | null>(null);

  const titleRef = useRef(title);
  const sectionRef = useRef(sectionId);
  const ensureRef = useRef<Promise<string | null> | null>(null);
  const bodyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const initialContent = useMemo(() => kernelToTiptap(props.initialDoc), [props.initialDoc]);

  // 懒创建：首次需要落库时创建草稿（幂等：并发调用共享同一 Promise）。返回 docId 或 null（失败）。
  const ensureDoc = useCallback(async (): Promise<string | null> => {
    if (docId !== null) {
      return docId;
    }
    if (ensureRef.current !== null) {
      return ensureRef.current;
    }
    ensureRef.current = (async () => {
      const r = await createDocument(
        titleRef.current.trim() || PLACEHOLDER_TITLE,
        sectionRef.current,
      );
      if (!r.ok) {
        ensureRef.current = null;
        setSaveState('error');
        setNotice({ kind: 'danger', text: r.error });
        return null;
      }
      const id = r.data.docId;
      setDocId(id);
      setHasRevisions(false);
      // 静默把 URL 换成编辑地址（不卸载编辑器；刷新即进 edit 模式）
      window.history.replaceState(null, '', `/write/${id}`);
      return id;
    })();
    return ensureRef.current;
  }, [docId]);

  // 正文自动保存（2s 防抖）
  const persistBody = useCallback(
    async (instance: Editor) => {
      setSaveState('saving');
      const id = await ensureDoc();
      if (id === null) {
        return;
      }
      const kernelDoc = tiptapToKernel(instance.getJSON());
      const r = await saveWorkingCopy(id, kernelDoc);
      setSaveState(r.ok ? 'saved' : 'error');
      if (!r.ok) {
        setNotice({ kind: 'danger', text: r.error });
      }
    },
    [ensureDoc],
  );

  const editor = useEditor({
    extensions: clientExtensions(),
    content: initialContent,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'prose-zh mx-auto min-h-[50vh] w-full max-w-[42rem] px-1 py-8 focus:outline-none',
        'aria-label': '正文编辑区',
      },
    },
    onUpdate: ({ editor: instance }) => {
      setSaveState('dirty');
      if (bodyTimer.current !== null) {
        clearTimeout(bodyTimer.current);
      }
      bodyTimer.current = setTimeout(() => void persistBody(instance), 2000);
    },
  });

  useEffect(
    () => () => {
      if (bodyTimer.current !== null) {
        clearTimeout(bodyTimer.current);
      }
      if (metaTimer.current !== null) {
        clearTimeout(metaTimer.current);
      }
    },
    [],
  );

  // 标题 textarea 自适应高度
  const autoGrow = useCallback(() => {
    const el = titleAreaRef.current;
    if (el !== null) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, []);
  useEffect(() => {
    autoGrow();
  }, [autoGrow]);

  // 元信息保存（标题/板块/摘要），1s 防抖；标题为空时不存（仍用占位）
  const persistMeta = useCallback(
    (patch: { title?: string; sectionId?: string; summary?: string }) => {
      setSaveState('dirty');
      if (metaTimer.current !== null) {
        clearTimeout(metaTimer.current);
      }
      metaTimer.current = setTimeout(async () => {
        setSaveState('saving');
        const id = await ensureDoc();
        if (id === null) {
          return;
        }
        const r = await updateDocumentMeta(id, patch);
        setSaveState(r.ok ? 'saved' : 'error');
        if (!r.ok) {
          setNotice({ kind: 'danger', text: r.error });
        }
      }, 1000);
    },
    [ensureDoc],
  );

  function onTitleChange(value: string) {
    const v = value.replace(/\n/g, '');
    setTitle(v);
    titleRef.current = v;
    autoGrow();
    if (v.trim().length > 0) {
      persistMeta({ title: v.trim() });
    }
  }

  function onSectionChange(value: string) {
    setSectionId(value);
    sectionRef.current = value;
    if (docId !== null) {
      persistMeta({ sectionId: value });
    }
  }

  function onSummaryChange(value: string) {
    setSummary(value);
    persistMeta({ summary: value.trim() });
  }

  async function persistTags(next: string[]) {
    const id = await ensureDoc();
    if (id === null) {
      return;
    }
    const r = await setDocumentTags(id, next);
    if (r.ok) {
      setTags(next);
    } else {
      setNotice({ kind: 'danger', text: r.error });
    }
  }

  function addTag() {
    const n = tagDraft.trim();
    if (n.length === 0 || tags.includes(n) || tags.length >= 5) {
      setTagDraft('');
      return;
    }
    const next = [...tags, n];
    setTagDraft('');
    void persistTags(next);
  }

  async function flushAll(): Promise<boolean> {
    if (bodyTimer.current !== null) {
      clearTimeout(bodyTimer.current);
      bodyTimer.current = null;
    }
    if (metaTimer.current !== null) {
      clearTimeout(metaTimer.current);
      metaTimer.current = null;
    }
    const id = await ensureDoc();
    if (id === null || !editor) {
      return false;
    }
    setSaveState('saving');
    const [body, meta] = await Promise.all([
      saveWorkingCopy(id, tiptapToKernel(editor.getJSON())),
      updateDocumentMeta(id, { title: title.trim() || PLACEHOLDER_TITLE, sectionId, summary }),
    ]);
    const failed = !body.ok ? body : !meta.ok ? meta : null;
    setSaveState(failed === null ? 'saved' : 'error');
    if (failed !== null) {
      setNotice({ kind: 'danger', text: failed.error });
    }
    return failed === null;
  }

  async function handleCommit() {
    setActionPending(true);
    setNotice(null);
    try {
      if (!(await flushAll())) {
        setNotice({ kind: 'danger', text: '草稿保存失败，已取消提交，请重试' });
        return;
      }
      const id = docId;
      if (id === null) {
        return;
      }
      const result = await commitRevision(id, commitMessage);
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
    if (title.trim().length === 0) {
      setNotice({ kind: 'danger', text: '发布前请先填写标题' });
      setPanelOpen(true);
      return;
    }
    const ok = await confirm({
      title: '申请发布？',
      description: '提交后将进入审校队列，志愿者审校通过后文章公开可见；期间你仍可继续修改。',
      confirmLabel: '申请发布',
    });
    if (!ok) {
      return;
    }
    setActionPending(true);
    setNotice(null);
    try {
      if (!(await flushAll())) {
        setNotice({ kind: 'danger', text: '草稿保存失败，已取消，请重试' });
        return;
      }
      const id = docId;
      if (id === null) {
        return;
      }
      // 申请发布前自动把当前草稿固化为一次修订（新文章无需手动「提交修订」）：
      // 内容有变则提交；与上次修订一致且已有修订则直接发布；空文章则提示先写内容。
      const commit = await commitRevision(id, '');
      if (commit.ok) {
        setHasRevisions(true);
        setHeadSeq(commit.data.seq);
      } else if (!hasRevisions) {
        setNotice({ kind: 'danger', text: commit.error });
        return;
      }
      const result = await requestPublish(id);
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

  // 新文章（草稿）：直接「申请发布」（内部自动固化修订），不暴露「提交修订」这个版本史概念；
  // 已发布文章在撰写器里再编辑时，「提交修订」才有意义（向版本历史追加一次改动）。
  const isDraft = docStatus === 'draft';
  const canRequestPublish = isDraft && title.trim().length > 0 && !actionPending && editor !== null;

  return (
    <div className="min-h-svh">
      {confirmDialog}
      {/* 顶部操作条：返回 / 状态 / 保存指示 / 发布设置 / 提交 / 发布 */}
      <div className="sticky top-0 z-30 border-ink-200 border-b bg-paper-100/90 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-2 px-4 py-2.5 sm:gap-3 sm:px-6">
          <button
            type="button"
            onClick={() => router.push('/write')}
            className="flex items-center gap-1 text-ink-500 text-sm transition-colors hover:text-brand-700"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
            草稿箱
          </button>
          <Badge variant={STATUS_BADGE_VARIANT[docStatus] ?? 'default'}>
            {docStatusLabel(docStatus)}
          </Badge>
          {headSeq !== null ? (
            <span className="hidden text-ink-400 text-xs sm:inline">第 {headSeq} 号修订</span>
          ) : null}
          <SaveIndicator state={saveState} />
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setPanelOpen(true)}
              aria-label="发布设置"
            >
              <Settings2 className="h-4 w-4" aria-hidden />
              {/* 窄屏只留齿轮图标，给状态徽标让出空间 */}
              <span className="hidden sm:inline">发布设置</span>
            </Button>
            {/* 「提交修订」= 向版本历史追加一次改动，仅对已发布文章的再编辑有意义；新草稿不显示 */}
            {!isDraft ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setCommitOpen((o) => !o)}
                disabled={actionPending || !editor}
              >
                提交修订
              </Button>
            ) : null}
            {isDraft ? (
              <Button
                type="button"
                size="sm"
                onClick={handleRequestPublish}
                disabled={!canRequestPublish}
                title={title.trim().length === 0 ? '请先填写标题' : ''}
              >
                申请发布
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {notice !== null ? (
        <div className="mx-auto w-full max-w-[44rem] px-6 pt-4">
          <Alert variant={notice.kind === 'info' ? 'info' : 'danger'}>{notice.text}</Alert>
        </div>
      ) : null}

      {/* 写作区：标题 + 工具栏 + 正文，居中单栏，读起来像成稿 */}
      <div className="mx-auto w-full max-w-[44rem] px-6">
        <textarea
          ref={titleAreaRef}
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          rows={1}
          placeholder="标题"
          aria-label="文章标题"
          className="mt-8 w-full resize-none overflow-hidden border-none bg-transparent font-semibold font-serif text-3xl text-ink-900 leading-snug tracking-wide outline-none placeholder:text-ink-300 sm:text-4xl"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2 text-ink-400 text-sm">
          <span>{props.sections.find((s) => s.id === sectionId)?.name ?? '未选板块'}</span>
          {tags.length > 0 ? <span aria-hidden>·</span> : null}
          {tags.map((t) => (
            <span key={t} className="text-ink-400">
              #{t}
            </span>
          ))}
          <button
            type="button"
            onClick={() => setPanelOpen(true)}
            className="text-brand-700 transition-colors hover:text-brand-900"
          >
            编辑
          </button>
        </div>
      </div>

      <div className="mt-6 border-ink-200 border-t">
        {editor ? (
          <>
            <EditorToolbar editor={editor} />
            <BubbleToolbar editor={editor} />
            <div className="mx-auto w-full max-w-[44rem] px-6">
              <EditorContent editor={editor} />
            </div>
          </>
        ) : (
          <p className="mx-auto max-w-[44rem] px-6 py-16 text-ink-400 text-sm">编辑器加载中…</p>
        )}
      </div>

      {/* 提交修订面板 */}
      {commitOpen ? (
        <div className="mx-auto w-full max-w-[44rem] px-6 pb-10">
          <section className="flex flex-col gap-3 rounded-md border border-ink-200 bg-paper-50 p-4 shadow-paper">
            <Label htmlFor="commit-message">修订说明（可选，便于历史回溯）</Label>
            <Textarea
              id="commit-message"
              rows={2}
              maxLength={500}
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
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
        </div>
      ) : null}

      {/* 发布设置抽屉：板块 / 摘要 / 标签 */}
      {panelOpen ? (
        <div className="fixed inset-0 z-40">
          <button
            type="button"
            aria-label="关闭发布设置"
            onClick={() => setPanelOpen(false)}
            className="absolute inset-0 bg-ink-900/20 backdrop-blur-[1px]"
          />
          <div className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col gap-6 overflow-y-auto bg-paper-50 p-6 shadow-float">
            <div className="flex items-center justify-between">
              <h2 className="font-medium font-serif text-ink-800 text-lg">发布设置</h2>
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                aria-label="关闭"
                className="text-ink-400 transition-colors hover:text-ink-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="compose-section">板块</Label>
              <select
                id="compose-section"
                value={sectionId}
                onChange={(e) => onSectionChange(e.target.value)}
                className="h-9 rounded-sm border border-ink-200 bg-paper-100 px-3 text-ink-800 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                {props.sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="compose-summary">摘要（选填，列表与分享卡展示）</Label>
              <Textarea
                id="compose-summary"
                rows={3}
                maxLength={200}
                value={summary}
                onChange={(e) => onSummaryChange(e.target.value)}
                placeholder="一句话概括这篇文章（最长 200 字）"
              />
              <span className="text-ink-400 text-xs">{summary.length}/200</span>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="compose-tag">标签（最多 5 个）</Label>
              <div className="flex flex-wrap items-center gap-2 rounded-sm border border-ink-200 bg-paper-100 p-2">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-full bg-paper-300 px-2 py-0.5 text-ink-700 text-sm"
                  >
                    #{t}
                    <button
                      type="button"
                      onClick={() => void persistTags(tags.filter((x) => x !== t))}
                      aria-label={`移除标签 ${t}`}
                      className="text-ink-400 hover:text-accent-700"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {tags.length < 5 ? (
                  <input
                    id="compose-tag"
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                    placeholder="输入后回车"
                    maxLength={20}
                    className="min-w-24 flex-1 bg-transparent px-1 text-ink-800 text-sm outline-none placeholder:text-ink-400"
                  />
                ) : null}
              </div>
            </div>

            <Button type="button" variant="secondary" onClick={() => setPanelOpen(false)}>
              完成
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'saving') {
    return (
      <span className="flex items-center gap-1 text-ink-400 text-xs">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        保存中
      </span>
    );
  }
  if (state === 'saved') {
    return (
      <span className="flex items-center gap-1 text-moss-700 text-xs">
        <Check className="h-3 w-3" aria-hidden />
        已保存
      </span>
    );
  }
  if (state === 'dirty') {
    return <span className="text-ink-400 text-xs">未保存…</span>;
  }
  if (state === 'error') {
    return <span className="text-accent-700 text-xs">保存失败</span>;
  }
  return null;
}
