'use client';

// 公告管理（管理员）：新建/编辑表单（标题 + 摘要 + 富文本正文）+ 列表（置顶切换、下线/重发）。
import type { DocJson } from '@harublog/kernel';
import { extractText } from '@harublog/kernel';
import { Alert, Button, Input, Label, Textarea, useToast } from '@harublog/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState } from 'react';
import {
  type AnnouncementInput,
  createAnnouncement,
  setAnnouncementPinned,
  setAnnouncementStatus,
  updateAnnouncement,
} from '@/server/actions/announcement';
import type { AnnouncementView } from '@/server/announcements';
import { AnnouncementBodyEditor } from './announcement-body-editor';

const EMPTY_DOC: DocJson = { type: 'doc', content: [] };

// 标量表单字段（正文 DocJson 另由 ref 持有）
interface ScalarForm {
  title: string;
  summary: string;
  level: 'info' | 'notice';
  pinned: boolean;
  linkHref: string;
  linkLabel: string;
}

const emptyForm: ScalarForm = {
  title: '',
  summary: '',
  level: 'info',
  pinned: false,
  linkHref: '',
  linkLabel: '',
};

// 旧公告（仅有纯文本 body、无 bodyDoc）进编辑器时，按换行还原成段落 DocJson
function plaintextToDoc(text: string): DocJson {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    type: 'doc',
    content: lines.map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })),
  } as DocJson;
}

function initialDocOf(a: AnnouncementView): DocJson {
  return a.bodyDoc ? (a.bodyDoc as DocJson) : plaintextToDoc(a.body);
}

export function AnnouncementManager({ items }: { items: AnnouncementView[] }) {
  const router = useRouter();
  const toast = useToast();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ScalarForm>(emptyForm);
  // 正文：编辑器初始内容（仅切换新建/编辑时变，避免逐键重挂）+ 实时值（ref，提交时取）
  const [initialBodyDoc, setInitialBodyDoc] = useState<DocJson>(EMPTY_DOC);
  const bodyDocRef = useRef<DocJson>(EMPTY_DOC);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function startEdit(a: AnnouncementView) {
    const doc = initialDocOf(a);
    setEditingId(a.id);
    setForm({
      title: a.title,
      summary: a.summary ?? '',
      level: a.level,
      pinned: a.pinned,
      linkHref: a.linkHref ?? '',
      linkLabel: a.linkLabel ?? '',
    });
    setInitialBodyDoc(doc);
    bodyDocRef.current = doc;
    setError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setInitialBodyDoc(EMPTY_DOC);
    bodyDocRef.current = EMPTY_DOC;
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.title.trim().length === 0) {
      setError('请填写标题');
      return;
    }
    if (extractText(bodyDocRef.current).trim().length === 0) {
      setError('请填写正文');
      return;
    }
    const input: AnnouncementInput = { ...form, bodyDoc: bodyDocRef.current };
    setBusy(true);
    const r =
      editingId === null
        ? await createAnnouncement(input)
        : await updateAnnouncement(editingId, input);
    if (r.ok) {
      toast(editingId === null ? '已发布公告' : '已更新公告', 'success');
      resetForm();
      router.refresh();
    } else {
      setError(r.error);
    }
    setBusy(false);
  }

  async function togglePin(a: AnnouncementView) {
    setBusy(true);
    const r = await setAnnouncementPinned(a.id, !a.pinned);
    if (r.ok) {
      toast(a.pinned ? '已取消置顶' : '已置顶到首页公告栏', 'success');
      router.refresh();
    } else {
      toast(r.error, 'error');
    }
    setBusy(false);
  }

  async function toggleStatus(a: AnnouncementView) {
    setBusy(true);
    const next = a.status === 'published' ? 'archived' : 'published';
    const r = await setAnnouncementStatus(a.id, next);
    if (r.ok) {
      toast(next === 'archived' ? '已下线' : '已重新发布', 'success');
      router.refresh();
    } else {
      toast(r.error, 'error');
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-8">
      {/* 表单 */}
      <form
        onSubmit={submit}
        className="flex flex-col gap-4 rounded-md border border-ink-200 bg-paper-50 p-5 shadow-paper"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold font-serif text-ink-900 text-lg">
            {editingId === null ? '发布新公告' : '编辑公告'}
          </h2>
          {editingId !== null ? (
            <button
              type="button"
              onClick={resetForm}
              className="text-ink-500 text-sm hover:text-brand-700"
            >
              + 改为新建
            </button>
          ) : null}
        </div>
        {error !== null ? <Alert variant="danger">{error}</Alert> : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="an-title">标题</Label>
          <Input
            id="an-title"
            value={form.title}
            maxLength={120}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="例如：求学路 v0.2 上线"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="an-summary">摘要（选填，列表与首页摘录展示；留空则自动截取正文）</Label>
          <Textarea
            id="an-summary"
            value={form.summary}
            rows={2}
            maxLength={300}
            onChange={(e) => setForm({ ...form, summary: e.target.value })}
            placeholder="一句话概括这条近闻"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          {/* key：切换新建/编辑时重挂编辑器，载入对应初始正文 */}
          <Label>正文</Label>
          <AnnouncementBodyEditor
            key={editingId ?? 'new'}
            initialDoc={initialBodyDoc}
            onChange={(doc) => {
              bodyDocRef.current = doc;
            }}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="an-link">链接（选填）</Label>
            <Input
              id="an-link"
              value={form.linkHref}
              maxLength={500}
              onChange={(e) => setForm({ ...form, linkHref: e.target.value })}
              placeholder="/s/college 或 https://…"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="an-link-label">链接文字（选填）</Label>
            <Input
              id="an-link-label"
              value={form.linkLabel}
              maxLength={40}
              onChange={(e) => setForm({ ...form, linkLabel: e.target.value })}
              placeholder="查看详情"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="an-level">类型</Label>
            <select
              id="an-level"
              value={form.level}
              onChange={(e) => setForm({ ...form, level: e.target.value as 'info' | 'notice' })}
              className="h-9 rounded-sm border border-ink-200 bg-paper-100 px-3 text-ink-800 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              <option value="info">新闻</option>
              <option value="notice">公告（更醒目）</option>
            </select>
          </div>
          <label className="flex items-center gap-2 pt-5 text-ink-700 text-sm">
            <input
              type="checkbox"
              checked={form.pinned}
              onChange={(e) => setForm({ ...form, pinned: e.target.checked })}
              className="size-4 accent-brand-700"
            />
            置顶到首页公告栏
          </label>
        </div>
        <Button type="submit" loading={busy} className="self-start">
          {editingId === null ? '发布' : '保存修改'}
        </Button>
      </form>

      {/* 列表 */}
      <section>
        <h2 className="font-semibold font-serif text-ink-900 text-lg">
          全部公告（{items.length}）
        </h2>
        {items.length > 0 ? (
          <ul className="mt-3 divide-y divide-ink-100">
            {items.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {a.level === 'notice' ? (
                      <span className="rounded-full bg-accent-50 px-2 py-0.5 font-medium text-accent-700">
                        公告
                      </span>
                    ) : (
                      <span className="rounded-full bg-paper-200 px-2 py-0.5 text-ink-600">
                        新闻
                      </span>
                    )}
                    {a.pinned ? (
                      <span className="rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-700">
                        首页置顶
                      </span>
                    ) : null}
                    {a.status === 'archived' ? (
                      <span className="rounded-full bg-ink-100 px-2 py-0.5 text-ink-500">
                        已下线
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 font-medium text-ink-900 text-sm">{a.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-ink-500 text-xs leading-relaxed">
                    {a.summary?.trim() || a.body}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => startEdit(a)}
                    disabled={busy}
                    className="text-brand-700 hover:text-brand-900"
                  >
                    编辑
                  </button>
                  {a.status === 'published' ? (
                    <button
                      type="button"
                      onClick={() => togglePin(a)}
                      disabled={busy}
                      className="text-ink-500 hover:text-brand-700"
                    >
                      {a.pinned ? '取消置顶' : '置顶'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => toggleStatus(a)}
                    disabled={busy}
                    className="text-ink-500 hover:text-accent-700"
                  >
                    {a.status === 'published' ? '下线' : '重新发布'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-ink-400 text-sm">还没有公告，从上方发布第一条。</p>
        )}
      </section>
    </div>
  );
}
