'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { resolveFlag } from '@/server/actions/flag';

export interface FlagReviewPanelProps {
  subjectType: 'comment' | 'document';
  subjectId: string;
}

export function FlagReviewPanel({ subjectType, subjectId }: FlagReviewPanelProps) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function act(action: 'uphold' | 'dismiss') {
    setBusy(true);
    setMsg(null);
    const result = await resolveFlag(subjectType, subjectId, action, note);
    if (result.ok) {
      router.refresh();
    } else {
      setMsg(result.error);
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="裁决说明（可选）"
        className="rounded-sm border border-ink-300 bg-paper-50 px-2 py-1.5 text-ink-800 text-sm placeholder:text-ink-400"
      />
      {msg !== null ? <p className="text-accent-700 text-sm">{msg}</p> : null}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => act('uphold')}
          disabled={busy}
          className="rounded-sm bg-danger-fill px-3 py-1.5 font-medium text-on-fill text-sm hover:bg-danger-fill-hover disabled:opacity-50"
        >
          采纳（隐藏内容）
        </button>
        <button
          type="button"
          onClick={() => act('dismiss')}
          disabled={busy}
          className="rounded-sm border border-ink-300 px-3 py-1.5 font-medium text-ink-700 text-sm hover:bg-paper-200 disabled:opacity-50"
        >
          驳回
        </button>
      </div>
    </div>
  );
}
