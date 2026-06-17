'use client';

// 标签编辑器：输入回车添加、点 × 移除，每次变更即时保存（整体替换）。最多 5 个。
import { useToast } from '@harublog/ui';
import { useState } from 'react';
import { setDocumentTags } from '@/server/actions/tags';

export function TagEditor({ docId, initialTags }: { docId: string; initialTags: string[] }) {
  const toast = useToast();
  const [list, setList] = useState<string[]>(initialTags);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  async function persist(next: string[]) {
    setBusy(true);
    const r = await setDocumentTags(docId, next);
    if (r.ok) {
      setList(next);
    } else {
      toast(r.error, 'error');
    }
    setBusy(false);
  }

  function add() {
    const n = draft.trim();
    if (n.length === 0 || list.includes(n) || list.length >= 5) {
      setDraft('');
      return;
    }
    void persist([...list, n]);
    setDraft('');
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {list.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-sm bg-brand-100 px-2 py-0.5 text-brand-800 text-sm"
          >
            {t}
            <button
              type="button"
              aria-label={`移除标签 ${t}`}
              disabled={busy}
              onClick={() => persist(list.filter((x) => x !== t))}
              className="text-brand-600 hover:text-accent-700"
            >
              ×
            </button>
          </span>
        ))}
        {list.length < 5 ? (
          <input
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            onBlur={add}
            placeholder="加标签，回车确认"
            maxLength={24}
            className="h-7 w-32 rounded-sm border border-ink-200 bg-paper-50 px-2 text-ink-800 text-sm placeholder:text-ink-400 focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
          />
        ) : null}
      </div>
      <p className="text-ink-400 text-xs">最多 5 个标签，帮助读者按主题发现你的博客。</p>
    </div>
  );
}
