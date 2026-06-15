'use client';

// 系列管理器（ADR-0014）：改名/改简介、重排（上下移，乐观更新）、移出条目、
// 加入已有文章、在系列内新建文章、删除系列。所有写操作走 series Server Actions（所有权直检）。
import { useConfirm, useToast } from '@harublog/ui';
import { ArrowDown, ArrowUp, ExternalLink, Plus, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { docStatusLabel } from '@/lib/doc-labels';
import {
  createDocumentInSeries,
  deleteSeries,
  reorderSeries,
  setDocumentSeries,
  updateSeries,
} from '@/server/actions/series';

export interface ManagerItem {
  documentId: string;
  title: string;
  status: string;
  slug: string;
}
interface Candidate {
  id: string;
  title: string;
  status: string;
}
interface SectionOpt {
  id: string;
  name: string;
}

interface SeriesManagerProps {
  seriesId: string;
  slug: string;
  initialTitle: string;
  initialDescription: string;
  initialItems: ManagerItem[];
  candidates: Candidate[];
  sections: SectionOpt[];
}

export function SeriesManager(props: SeriesManagerProps) {
  const router = useRouter();
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();

  const [title, setTitle] = useState(props.initialTitle);
  const [description, setDescription] = useState(props.initialDescription);
  const [savingMeta, setSavingMeta] = useState(false);

  const [items, setItems] = useState<ManagerItem[]>(props.initialItems);
  const [candidates, setCandidates] = useState<Candidate[]>(props.candidates);
  const [busy, setBusy] = useState(false);

  const [addPick, setAddPick] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newSection, setNewSection] = useState(props.sections[0]?.id ?? '');
  const [creating, setCreating] = useState(false);

  const metaDirty =
    title.trim() !== props.initialTitle || description.trim() !== props.initialDescription;

  async function saveMeta() {
    const name = title.trim();
    if (name.length === 0) {
      toast('系列名不能为空', 'error');
      return;
    }
    setSavingMeta(true);
    try {
      const r = await updateSeries(props.seriesId, { title: name, description });
      if (!r.ok) {
        toast(r.error, 'error');
        return;
      }
      toast('已保存', 'success');
      router.refresh();
    } finally {
      setSavingMeta(false);
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= items.length || busy) {
      return;
    }
    const prev = items;
    const next = [...items];
    const a = next[index];
    const b = next[j];
    if (a === undefined || b === undefined) {
      return;
    }
    next[index] = b;
    next[j] = a;
    setItems(next);
    setBusy(true);
    try {
      const r = await reorderSeries(
        props.seriesId,
        next.map((it) => it.documentId),
      );
      if (!r.ok) {
        setItems(prev);
        toast(r.error, 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(item: ManagerItem) {
    if (!(await confirm({ title: `把《${item.title}》移出系列？`, confirmLabel: '移出' }))) {
      return;
    }
    setBusy(true);
    try {
      const r = await setDocumentSeries(item.documentId, null);
      if (!r.ok) {
        toast(r.error, 'error');
        return;
      }
      setItems((p) => p.filter((it) => it.documentId !== item.documentId));
      setCandidates((p) => [{ id: item.documentId, title: item.title, status: item.status }, ...p]);
      toast('已移出系列', 'success');
    } finally {
      setBusy(false);
    }
  }

  async function addExisting() {
    if (addPick === '' || busy) {
      return;
    }
    const cand = candidates.find((c) => c.id === addPick);
    if (cand === undefined) {
      return;
    }
    setBusy(true);
    try {
      const r = await setDocumentSeries(cand.id, props.seriesId);
      if (!r.ok) {
        toast(r.error, 'error');
        return;
      }
      setCandidates((p) => p.filter((c) => c.id !== cand.id));
      setItems((p) => [
        ...p,
        { documentId: cand.id, title: cand.title, status: cand.status, slug: '' },
      ]);
      setAddPick('');
      toast('已加入系列', 'success');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function createNew() {
    const name = newTitle.trim();
    if (name.length === 0 || newSection === '') {
      return;
    }
    setCreating(true);
    try {
      const r = await createDocumentInSeries(name, newSection, props.seriesId);
      if (!r.ok) {
        toast(r.error, 'error');
        return;
      }
      router.push(`/write/${r.data.docId}`);
    } finally {
      setCreating(false);
    }
  }

  async function onDeleteSeries() {
    if (
      !(await confirm({
        title: '删除这个系列？',
        description: '只删除系列本身与其编排，文章不会被删除。此操作不可撤销。',
        danger: true,
        confirmLabel: '删除系列',
      }))
    ) {
      return;
    }
    const r = await deleteSeries(props.seriesId);
    if (!r.ok) {
      toast(r.error, 'error');
      return;
    }
    toast('系列已删除', 'success');
    router.push('/write/series');
  }

  return (
    <div className="flex flex-col gap-8">
      {/* 系列信息编辑 */}
      <section className="flex flex-col gap-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={80}
          aria-label="系列名"
          className="h-11 rounded-lg border border-ink-200 bg-paper-50 px-3.5 font-semibold font-serif text-ink-900 text-lg placeholder:text-ink-400 focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={300}
          rows={2}
          aria-label="系列简介"
          placeholder="系列简介（选填，最长 300 字）"
          className="resize-none rounded-lg border border-ink-200 bg-paper-50 px-3.5 py-2.5 text-ink-700 text-sm placeholder:text-ink-400 focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void saveMeta()}
            disabled={savingMeta || !metaDirty}
            className="h-9 rounded-lg bg-fill px-4 font-medium text-on-fill text-sm transition-colors hover:bg-fill-hover disabled:opacity-50"
          >
            保存信息
          </button>
          <Link
            href={`/series/${props.slug}`}
            className="inline-flex items-center gap-1.5 text-ink-500 text-sm transition-colors hover:text-brand-700"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            查看系列页
          </Link>
        </div>
      </section>

      {/* 条目排序 */}
      <section>
        <h2 className="font-medium font-serif text-ink-800">系列内文章（{items.length}）</h2>
        <p className="mt-1 text-ink-400 text-xs">用上下箭头调整顺序，顺序即读者的阅读次序。</p>
        {items.length === 0 ? (
          <p className="mt-4 rounded-lg border border-ink-100 border-dashed px-4 py-8 text-center text-ink-400 text-sm">
            还没有文章。从下方加入已有文章，或在系列内新建。
          </p>
        ) : (
          <ol className="mt-3 flex flex-col gap-2">
            {items.map((it, i) => (
              <li
                key={it.documentId}
                className="flex items-center gap-3 rounded-lg border border-ink-100 bg-paper-50 p-3"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-paper-200 text-ink-500 text-xs tabular-nums">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <Link
                    href={`/write/${it.documentId}`}
                    className="truncate font-medium text-ink-800 text-sm transition-colors hover:text-brand-700"
                  >
                    {it.title}
                  </Link>
                  {it.status !== 'published' ? (
                    <span className="ml-2 text-ink-400 text-xs">{docStatusLabel(it.status)}</span>
                  ) : null}
                </span>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => void move(i, -1)}
                    disabled={i === 0 || busy}
                    aria-label="上移"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-paper-200 hover:text-ink-800 disabled:opacity-30"
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => void move(i, 1)}
                    disabled={i === items.length - 1 || busy}
                    aria-label="下移"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-paper-200 hover:text-ink-800 disabled:opacity-30"
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeItem(it)}
                    disabled={busy}
                    aria-label="移出系列"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-ink-400 transition-colors hover:bg-accent-50 hover:text-accent-700 disabled:opacity-30"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* 加入已有文章 */}
      <section>
        <h2 className="font-medium font-serif text-ink-800">加入已有文章</h2>
        {candidates.length === 0 ? (
          <p className="mt-2 text-ink-400 text-sm">没有可加入的文章了。</p>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={addPick}
              onChange={(e) => setAddPick(e.target.value)}
              className="h-9 min-w-0 flex-1 rounded-lg border border-ink-200 bg-paper-50 px-3 text-ink-800 text-sm focus-visible:outline-2 focus-visible:outline-brand-600 focus-visible:outline-offset-2"
            >
              <option value="">选择一篇文章…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                  {c.status !== 'published' ? `（${docStatusLabel(c.status)}）` : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void addExisting()}
              disabled={addPick === '' || busy}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-ink-200 px-3 font-medium text-ink-700 text-sm transition-colors hover:border-brand-300 hover:text-brand-700 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" aria-hidden />
              加入
            </button>
          </div>
        )}
      </section>

      {/* 在系列内新建文章 */}
      <section>
        <h2 className="font-medium font-serif text-ink-800">在系列内新建文章</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            maxLength={120}
            placeholder="新文章标题"
            className="h-9 min-w-0 flex-1 rounded-lg border border-ink-200 bg-paper-50 px-3 text-ink-800 text-sm placeholder:text-ink-400 focus-visible:outline-2 focus-visible:outline-brand-600 focus-visible:outline-offset-2"
          />
          <select
            value={newSection}
            onChange={(e) => setNewSection(e.target.value)}
            aria-label="板块"
            className="h-9 shrink-0 rounded-lg border border-ink-200 bg-paper-50 px-3 text-ink-800 text-sm focus-visible:outline-2 focus-visible:outline-brand-600 focus-visible:outline-offset-2"
          >
            {props.sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void createNew()}
            disabled={creating || newTitle.trim().length === 0 || newSection === ''}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-fill px-3 font-medium text-on-fill text-sm transition-colors hover:bg-fill-hover disabled:opacity-50"
          >
            <Plus className="h-4 w-4" aria-hidden />
            新建并编辑
          </button>
        </div>
      </section>

      {/* 危险区 */}
      <section className="border-ink-100 border-t pt-6">
        <button
          type="button"
          onClick={() => void onDeleteSeries()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-accent-200 px-3 py-2 font-medium text-accent-700 text-sm transition-colors hover:bg-accent-50"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          删除系列
        </button>
        <p className="mt-2 text-ink-400 text-xs">只删除系列与其编排，文章本身不受影响。</p>
      </section>

      {confirmDialog}
    </div>
  );
}
