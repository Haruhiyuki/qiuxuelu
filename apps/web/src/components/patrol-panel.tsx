'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { patrolApprove, patrolRevert } from '@/server/actions/patrol';

export function PatrolPanel({ revisionId }: { revisionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function approve() {
    setBusy(true);
    setMsg(null);
    const r = await patrolApprove(revisionId);
    if (r.ok) router.refresh();
    else {
      setMsg(r.error);
      setBusy(false);
    }
  }
  async function revert() {
    if (!window.confirm('确认回退这次协作编辑？将创建一个还原到改前内容的新修订（历史保留）。')) {
      return;
    }
    setBusy(true);
    setMsg(null);
    const r = await patrolRevert(revisionId);
    if (r.ok) router.refresh();
    else {
      setMsg(r.error);
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      {msg !== null ? <p className="text-accent-700 text-sm">{msg}</p> : null}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={approve}
          disabled={busy}
          className="rounded-sm border border-ink-300 px-3 py-1.5 font-medium text-ink-700 text-sm hover:bg-paper-200 disabled:opacity-50"
        >
          标记已巡查
        </button>
        <button
          type="button"
          onClick={revert}
          disabled={busy}
          className="rounded-sm bg-accent-700 px-3 py-1.5 font-medium text-paper-50 text-sm hover:bg-accent-800 disabled:opacity-50"
        >
          回退此编辑
        </button>
      </div>
    </div>
  );
}
