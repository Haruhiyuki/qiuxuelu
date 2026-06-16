'use client';

// 管理员复核单条申诉：受理（撤销制裁）或驳回，可附说明。
import { useToast } from '@harublog/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { resolveAppeal } from '@/server/actions/appeal';

export function AppealReviewPanel({ appealId }: { appealId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function resolve(accept: boolean) {
    setBusy(true);
    try {
      const r = await resolveAppeal(appealId, accept, note);
      if (!r.ok) {
        toast(r.error, 'error');
        return;
      }
      toast(accept ? '已受理：对应制裁已撤销' : '已驳回申诉', 'success');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2 border-ink-100 border-t pt-3">
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={1000}
        placeholder="处理说明（可选，会展示给申诉人）"
        className="rounded-sm border border-ink-300 bg-paper-50 px-2.5 py-1.5 text-ink-800 text-sm placeholder:text-ink-400"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void resolve(true)}
          disabled={busy}
          className="rounded-sm bg-fill px-3 py-1.5 font-medium text-on-fill text-sm transition-colors hover:bg-fill-hover disabled:opacity-50"
        >
          受理并撤销制裁
        </button>
        <button
          type="button"
          onClick={() => void resolve(false)}
          disabled={busy}
          className="rounded-sm border border-ink-300 px-3 py-1.5 font-medium text-ink-700 text-sm transition-colors hover:bg-paper-200 disabled:opacity-50"
        >
          驳回
        </button>
      </div>
    </div>
  );
}
