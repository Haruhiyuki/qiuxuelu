'use client';

import { useToast } from '@harublog/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FLAG_REASON_CODES, FLAG_REASON_LABELS } from '@/lib/flag-reasons';
import { flagContent } from '@/server/actions/flag';

export interface FlagButtonProps {
  subjectType: 'comment' | 'document';
  subjectId: string;
}

export function FlagButton({ subjectType, subjectId }: FlagButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const toast = useToast();

  async function submit() {
    if (reason === '') {
      setMsg('请选择举报理由');
      return;
    }
    setBusy(true);
    setMsg(null);
    const result = await flagContent(subjectType, subjectId, reason, note);
    if (result.ok) {
      setOpen(false);
      setReason('');
      setNote('');
      setMsg(null);
      router.refresh();
      toast('已提交举报，管理员会尽快处理。感谢你维护社区。', 'success');
    } else {
      setMsg(result.error);
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-ink-400 text-xs hover:text-accent-700"
      >
        举报
      </button>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-sm border border-ink-200 bg-paper-100 p-3">
      <select
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="rounded-sm border border-ink-300 bg-paper-50 px-2 py-1.5 text-ink-800 text-sm"
        aria-label="举报理由"
      >
        <option value="">选择举报理由…</option>
        {FLAG_REASON_CODES.map((code) => (
          <option key={code} value={code}>
            {FLAG_REASON_LABELS[code]}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="补充说明（可选）"
        className="rounded-sm border border-ink-300 bg-paper-50 px-2 py-1.5 text-ink-800 text-sm placeholder:text-ink-400"
      />
      {msg !== null ? <p className="text-accent-700 text-xs">{msg}</p> : null}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="rounded-sm bg-danger-fill px-2.5 py-1 font-medium text-on-fill text-xs hover:bg-danger-fill-hover disabled:opacity-50"
        >
          {busy ? '提交中…' : '提交举报'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-ink-500 text-xs hover:text-ink-700"
        >
          取消
        </button>
      </div>
    </div>
  );
}
