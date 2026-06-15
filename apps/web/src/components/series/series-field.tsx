'use client';

// 撰写器发布抽屉里的「系列」选择器：把当前文章归入/移出某系列，或就地新建系列。
// docId 可能为空（new 模式懒创建）：选定时先 ensureDoc 落库再归类。
import { useToast } from '@harublog/ui';
import { useState } from 'react';
import { createSeries, setDocumentSeries } from '@/server/actions/series';

interface SeriesOption {
  id: string;
  title: string;
}

interface SeriesFieldProps {
  docId: string | null;
  /** new 模式：选定系列前先把草稿落库，返回 docId（失败 null）。 */
  ensureDoc: () => Promise<string | null>;
  options: SeriesOption[];
  initialSeriesId: string | null;
}

const NEW = '__new__';

export function SeriesField({ docId, ensureDoc, options, initialSeriesId }: SeriesFieldProps) {
  const toast = useToast();
  const [opts, setOpts] = useState<SeriesOption[]>(options);
  const [seriesId, setSeriesId] = useState<string>(initialSeriesId ?? '');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [pending, setPending] = useState(false);

  // 把文档归入 target 系列（''=移出）。new 模式先落库。
  async function assign(target: string) {
    setPending(true);
    try {
      let id = docId;
      if (target !== '' && id === null) {
        id = await ensureDoc();
        if (id === null) {
          // ensureDoc 已就失败原因给出提示（如未填标题/未过授权闸）
          return false;
        }
      }
      if (id === null) {
        // 文档还不存在且要移出——本就为空，仅更新本地状态
        return true;
      }
      const r = await setDocumentSeries(id, target === '' ? null : target);
      if (!r.ok) {
        toast(r.error, 'error');
        return false;
      }
      return true;
    } finally {
      setPending(false);
    }
  }

  async function onSelect(value: string) {
    if (value === NEW) {
      setCreating(true);
      return;
    }
    const prev = seriesId;
    setSeriesId(value);
    const ok = await assign(value);
    if (!ok) {
      setSeriesId(prev);
    } else if (value !== '') {
      toast('已加入系列', 'success');
    }
  }

  async function onCreate() {
    const name = newName.trim();
    if (name.length === 0) {
      return;
    }
    setPending(true);
    try {
      const r = await createSeries(name);
      if (!r.ok) {
        toast(r.error, 'error');
        return;
      }
      const created = { id: r.data.seriesId, title: name };
      setOpts((p) => [created, ...p]);
      setCreating(false);
      setNewName('');
      setSeriesId(created.id);
      const ok = await assign(created.id);
      if (ok) {
        toast('已新建系列并加入', 'success');
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-medium text-ink-700 text-sm">系列（选填）</span>
      {creating ? (
        <div className="flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void onCreate();
              }
            }}
            maxLength={80}
            placeholder="新系列名"
            className="h-9 flex-1 rounded-sm border border-ink-200 bg-paper-100 px-3 text-ink-800 text-sm focus-visible:outline-2 focus-visible:outline-brand-600 focus-visible:outline-offset-2"
          />
          <button
            type="button"
            onClick={() => void onCreate()}
            disabled={pending || newName.trim().length === 0}
            className="h-9 shrink-0 rounded-sm bg-fill px-3 font-medium text-on-fill text-sm transition-colors hover:bg-fill-hover disabled:opacity-50"
          >
            创建
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating(false);
              setNewName('');
            }}
            className="h-9 shrink-0 rounded-sm px-2 text-ink-500 text-sm transition-colors hover:text-ink-800"
          >
            取消
          </button>
        </div>
      ) : (
        <select
          value={seriesId}
          disabled={pending}
          onChange={(e) => void onSelect(e.target.value)}
          className="h-9 rounded-sm border border-ink-200 bg-paper-100 px-3 text-ink-800 text-sm focus-visible:outline-2 focus-visible:outline-brand-600 focus-visible:outline-offset-2 disabled:opacity-60"
        >
          <option value="">不属于任何系列</option>
          {opts.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
          <option value={NEW}>+ 新建系列…</option>
        </select>
      )}
      <span className="text-ink-400 text-xs">把本文归入一个系列，读者可在文章底部顺序阅读。</span>
    </div>
  );
}
