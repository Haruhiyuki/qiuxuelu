'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type ConflictResolutions, mergeSuggestion } from '@/server/actions/suggestion';

export interface ConflictBlockView {
  blockId: string;
  oursText: string | null; // null = 主线已删除该块
  theirsText: string | null; // null = 建议删除了该块
}

export function ConflictResolver({
  suggestionId,
  slug,
  conflicts,
}: {
  suggestionId: string;
  slug: string;
  conflicts: ConflictBlockView[];
}) {
  const router = useRouter();
  const [choices, setChoices] = useState<ConflictResolutions>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const allChosen = conflicts.every((c) => choices[c.blockId] !== undefined);

  async function submit() {
    if (!allChosen) {
      setMsg('请为每处冲突做出选择');
      return;
    }
    setBusy(true);
    setMsg(null);
    const r = await mergeSuggestion(suggestionId, choices);
    if (r.ok && r.data.merged) {
      router.push(`/a/${slug}`);
      router.refresh();
    } else if (r.ok && !r.data.merged) {
      setMsg('仍有未解决的冲突，请重试');
      setBusy(false);
    } else if (!r.ok) {
      setMsg(r.error);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {msg !== null ? <p className="text-accent-700 text-sm">{msg}</p> : null}
      <ul className="flex flex-col gap-6">
        {conflicts.map((c, i) => {
          const choice = choices[c.blockId];
          return (
            <li key={c.blockId} className="rounded-sm border border-ink-200 bg-paper-50 p-4">
              <p className="mb-3 font-medium text-ink-700 text-sm">冲突 {i + 1}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label
                  className={`flex cursor-pointer flex-col gap-2 rounded-sm border p-3 ${
                    choice === 'ours' ? 'border-brand-500 bg-brand-50' : 'border-ink-200'
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={`c-${c.blockId}`}
                      checked={choice === 'ours'}
                      onChange={() => setChoices((p) => ({ ...p, [c.blockId]: 'ours' }))}
                    />
                    <span className="font-medium text-ink-800">采用主线版本</span>
                  </span>
                  <span className="whitespace-pre-wrap text-ink-600 text-sm leading-relaxed">
                    {c.oursText ?? '（主线已删除此段）'}
                  </span>
                </label>
                <label
                  className={`flex cursor-pointer flex-col gap-2 rounded-sm border p-3 ${
                    choice === 'theirs' ? 'border-brand-500 bg-brand-50' : 'border-ink-200'
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={`c-${c.blockId}`}
                      checked={choice === 'theirs'}
                      onChange={() => setChoices((p) => ({ ...p, [c.blockId]: 'theirs' }))}
                    />
                    <span className="font-medium text-ink-800">采用建议版本</span>
                  </span>
                  <span className="whitespace-pre-wrap text-ink-600 text-sm leading-relaxed">
                    {c.theirsText ?? '（建议删除此段）'}
                  </span>
                </label>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={busy || !allChosen}
          className="rounded-sm bg-brand-700 px-4 py-2 font-medium text-paper-50 text-sm hover:bg-brand-800 disabled:opacity-50"
        >
          {busy ? '合入中…' : '按裁决合入'}
        </button>
        <button
          type="button"
          onClick={() => router.push(`/suggestions/${suggestionId}`)}
          className="text-ink-500 text-sm hover:text-ink-700"
        >
          返回建议
        </button>
      </div>
    </div>
  );
}
