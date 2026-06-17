'use client';

// 板块管理面板（admin+）：新建、重命名、调整顺序（上下移）、移动博客所属板块、删除（需空）。
import { useConfirm, useToast } from '@harublog/ui';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { docStatusLabel } from '@/lib/doc-labels';
import {
  createSection,
  deleteSection,
  moveDocumentSection,
  renameSection,
  reorderSections,
} from '@/server/actions/section';

export interface SectionRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  docCount: number;
}
export interface SectionDoc {
  id: string;
  title: string;
  status: string;
  sectionId: string;
}

export function SectionManager({
  initialSections,
  docs,
}: {
  initialSections: SectionRow[];
  docs: SectionDoc[];
}) {
  const router = useRouter();
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [items, setItems] = useState<SectionRow[]>(initialSections);
  const [busy, setBusy] = useState(false);

  // 新建表单
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  // 行内编辑中的板块 id + 草稿
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editSlug, setEditSlug] = useState('');

  const sectionOptions = items.map((s) => ({ id: s.id, name: s.name }));

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setBusy(true);
    try {
      const r = await fn();
      if (!r.ok) {
        toast(r.error ?? '操作失败', 'error');
        return false;
      }
      toast(okMsg, 'success');
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (newName.trim().length === 0) {
      return;
    }
    const ok = await run(() => createSection(newName, newSlug || undefined), '板块已创建');
    if (ok) {
      setNewName('');
      setNewSlug('');
    }
  }

  async function saveRename(id: string) {
    const ok = await run(
      () => renameSection(id, { name: editName, slug: editSlug || undefined }),
      '已保存',
    );
    if (ok) {
      setEditId(null);
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
      const r = await reorderSections(next.map((s) => s.id));
      if (!r.ok) {
        setItems(prev);
        toast(r.error, 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  async function removeSection(s: SectionRow) {
    if (s.docCount > 0) {
      toast(`「${s.name}」下还有 ${s.docCount} 篇博客，请先移走`, 'error');
      return;
    }
    if (
      !(await confirm({ title: `删除板块「${s.name}」？`, danger: true, confirmLabel: '删除' }))
    ) {
      return;
    }
    await run(() => deleteSection(s.id), '板块已删除');
  }

  async function moveDoc(docId: string, sectionId: string) {
    await run(() => moveDocumentSection(docId, sectionId), '博客已移动');
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 新建板块 */}
      <section className="rounded-lg border border-ink-200 bg-paper-50 p-4">
        <h2 className="font-medium font-serif text-ink-800">新建板块</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={20}
            placeholder="板块名（如：中学）"
            className="h-9 w-40 rounded-sm border border-ink-200 bg-paper-100 px-3 text-ink-800 text-sm focus-visible:outline-2 focus-visible:outline-brand-600 focus-visible:outline-offset-2"
          />
          <input
            value={newSlug}
            onChange={(e) => setNewSlug(e.target.value)}
            maxLength={40}
            placeholder="slug（选填，默认自动）"
            className="h-9 w-52 rounded-sm border border-ink-200 bg-paper-100 px-3 text-ink-800 text-sm focus-visible:outline-2 focus-visible:outline-brand-600 focus-visible:outline-offset-2"
          />
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy || newName.trim().length === 0}
            className="inline-flex h-9 items-center gap-1.5 rounded-sm bg-fill px-3 font-medium text-on-fill text-sm transition-colors hover:bg-fill-hover disabled:opacity-50"
          >
            <Plus className="h-4 w-4" aria-hidden />
            新建
          </button>
        </div>
      </section>

      {/* 板块列表 */}
      <ul className="flex flex-col gap-3">
        {items.map((s, i) => {
          const sectionDocs = docs.filter((d) => d.sectionId === s.id);
          return (
            <li key={s.id} className="rounded-lg border border-ink-200 bg-paper-50 p-4">
              <div className="flex items-center gap-3">
                <div className="flex shrink-0 flex-col">
                  <button
                    type="button"
                    onClick={() => void move(i, -1)}
                    disabled={i === 0 || busy}
                    aria-label="上移"
                    className="text-ink-400 transition-colors hover:text-ink-800 disabled:opacity-30"
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => void move(i, 1)}
                    disabled={i === items.length - 1 || busy}
                    aria-label="下移"
                    className="text-ink-400 transition-colors hover:text-ink-800 disabled:opacity-30"
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden />
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  <span className="font-medium font-serif text-ink-900">{s.name}</span>
                  <span className="ml-2 text-ink-400 text-xs">/{s.slug}</span>
                  <span className="ml-2 text-ink-400 text-xs tabular-nums">{s.docCount} 篇</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditId(s.id);
                    setEditName(s.name);
                    setEditSlug(s.slug);
                  }}
                  className="shrink-0 text-ink-500 text-sm transition-colors hover:text-brand-700"
                >
                  重命名
                </button>
                <button
                  type="button"
                  onClick={() => void removeSection(s)}
                  disabled={busy}
                  aria-label="删除板块"
                  className="shrink-0 text-ink-400 transition-colors hover:text-accent-700 disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </div>

              {editId === s.id ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-ink-100 border-t pt-3">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    maxLength={20}
                    className="h-9 w-40 rounded-sm border border-ink-200 bg-paper-100 px-3 text-ink-800 text-sm"
                  />
                  <input
                    value={editSlug}
                    onChange={(e) => setEditSlug(e.target.value)}
                    maxLength={40}
                    placeholder="slug"
                    className="h-9 w-52 rounded-sm border border-ink-200 bg-paper-100 px-3 text-ink-800 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => void saveRename(s.id)}
                    disabled={busy}
                    className="h-9 rounded-sm bg-fill px-3 font-medium text-on-fill text-sm hover:bg-fill-hover disabled:opacity-50"
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditId(null)}
                    className="h-9 px-2 text-ink-500 text-sm hover:text-ink-800"
                  >
                    取消
                  </button>
                </div>
              ) : null}

              {sectionDocs.length > 0 ? (
                <details className="mt-3 border-ink-100 border-t pt-3">
                  <summary className="cursor-pointer text-ink-500 text-sm transition-colors hover:text-ink-800">
                    博客（{sectionDocs.length}）—— 可移动所属板块
                  </summary>
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {sectionDocs.map((d) => (
                      <li key={d.id} className="flex items-center gap-2 text-sm">
                        <span className="min-w-0 flex-1 truncate text-ink-700">
                          {d.title}
                          {d.status !== 'published' ? (
                            <span className="ml-1.5 text-ink-400 text-xs">
                              {docStatusLabel(d.status)}
                            </span>
                          ) : null}
                        </span>
                        <select
                          value={s.id}
                          disabled={busy}
                          onChange={(e) => void moveDoc(d.id, e.target.value)}
                          aria-label={`将《${d.title}》移到板块`}
                          className="h-8 shrink-0 rounded-sm border border-ink-200 bg-paper-100 px-2 text-ink-700 text-xs focus-visible:outline-2 focus-visible:outline-brand-600 focus-visible:outline-offset-2"
                        >
                          {sectionOptions.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                        </select>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>

      {confirmDialog}
    </div>
  );
}
