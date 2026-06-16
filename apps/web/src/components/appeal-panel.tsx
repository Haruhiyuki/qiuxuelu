'use client';

// 账户页「我的处罚与申诉」：列出当前生效的制裁，未申诉的可发起申诉，已驳回的可附理由再次申诉。
import { useToast } from '@harublog/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { submitAppeal } from '@/server/actions/appeal';

export interface SanctionView {
  id: string;
  kindLabel: string;
  reason: string;
  endsLabel: string;
  /** 该制裁最新申诉状态（无则 null） */
  appeal: { status: string; decisionNote: string | null } | null;
}

function SanctionRow({ s }: { s: SanctionView }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const pending = s.appeal?.status === 'open';
  const rejected = s.appeal?.status === 'rejected';

  async function submit() {
    if (reason.trim().length === 0) {
      return;
    }
    setBusy(true);
    try {
      const r = await submitAppeal(s.id, reason);
      if (!r.ok) {
        toast(r.error, 'error');
        return;
      }
      toast('申诉已提交，管理员会尽快复核', 'success');
      setOpen(false);
      setReason('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-md border border-ink-200 bg-paper-100 p-3.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-ink-800 text-sm">{s.kindLabel}</span>
        <span className="text-ink-400 text-xs">{s.endsLabel}</span>
        {pending ? (
          <span className="rounded-full bg-ochre-50 px-2 py-0.5 font-medium text-ochre-800 text-xs">
            申诉处理中
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-ink-600 text-sm leading-relaxed">理由：{s.reason}</p>

      {rejected ? (
        <p className="mt-2 text-ink-500 text-xs leading-relaxed">
          上次申诉已被驳回
          {s.appeal?.decisionNote ? `：${s.appeal.decisionNote}` : ''}
        </p>
      ) : null}

      {pending ? null : open ? (
        <div className="mt-3 flex flex-col gap-2">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="说明你认为该处罚不当的理由…"
            className="resize-none rounded-sm border border-ink-300 bg-paper-50 px-3 py-2 text-ink-800 text-sm placeholder:text-ink-400 focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || reason.trim().length === 0}
              className="rounded-sm bg-fill px-3 py-1.5 font-medium text-on-fill text-sm transition-colors hover:bg-fill-hover disabled:opacity-50"
            >
              {busy ? '提交中…' : '提交申诉'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-ink-500 text-sm transition-colors hover:text-ink-700"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 text-brand-700 text-sm transition-colors hover:text-brand-900"
        >
          {rejected ? '再次申诉' : '发起申诉'}
        </button>
      )}
    </li>
  );
}

export function AppealPanel({ sanctions }: { sanctions: SanctionView[] }) {
  if (sanctions.length === 0) {
    return null;
  }
  return (
    <section className="rounded-lg border border-accent-200 bg-paper-50 p-5 shadow-paper">
      <h2 className="font-medium font-serif text-ink-900 text-lg">我的处罚与申诉</h2>
      <p className="mt-1 text-ink-500 text-sm">
        以下处罚正在对你生效。若认为裁决不当，可发起申诉，管理员会复核。
      </p>
      <ul className="mt-4 flex flex-col gap-3">
        {sanctions.map((s) => (
          <SanctionRow key={s.id} s={s} />
        ))}
      </ul>
    </section>
  );
}
