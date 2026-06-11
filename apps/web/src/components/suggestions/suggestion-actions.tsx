'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { REJECT_REASON_CODES, REJECT_REASON_LABELS } from '@/lib/review-reasons';
import {
  rejectSuggestion,
  requestSuggestionChanges,
  withdrawSuggestion,
} from '@/server/actions/suggestion';

export interface SuggestionActionsProps {
  suggestionId: string;
  status: string;
  isAuthor: boolean;
  canReview: boolean;
  /** 步骤③接入：审校者可见「采纳合入」。 */
  mergeSlot?: React.ReactNode;
}

const ACTIVE = new Set(['open', 'under_review', 'changes_requested', 'outdated']);

export function SuggestionActions({
  suggestionId,
  status,
  isAuthor,
  canReview,
  mergeSlot,
}: SuggestionActionsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');

  if (!ACTIVE.has(status)) {
    return null;
  }

  async function run(p: Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setMsg(null);
    const r = await p;
    if (r.ok) {
      router.refresh();
    } else {
      setMsg(r.error ?? '操作失败');
      setBusy(false);
    }
  }

  const reviewerCanAct = canReview && !isAuthor && status !== 'outdated';

  return (
    <div className="mt-6 flex flex-col gap-3 border-ink-200 border-t pt-6">
      {msg !== null ? <p className="text-accent-700 text-sm">{msg}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        {reviewerCanAct ? mergeSlot : null}
        {reviewerCanAct ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => setChangesOpen((v) => !v)}
              className="rounded-sm border border-ink-300 px-3 py-1.5 font-medium text-ink-700 text-sm hover:bg-paper-200"
            >
              要求修改
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setRejectOpen((v) => !v)}
              className="rounded-sm border border-ink-300 px-3 py-1.5 font-medium text-ink-700 text-sm hover:bg-paper-200"
            >
              驳回
            </button>
          </>
        ) : null}
        {isAuthor ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(withdrawSuggestion(suggestionId))}
            className="rounded-sm border border-ink-300 px-3 py-1.5 font-medium text-ink-700 text-sm hover:bg-paper-200"
          >
            撤回建议
          </button>
        ) : null}
      </div>

      {changesOpen ? (
        <div className="flex flex-col gap-2 rounded-sm border border-ink-200 bg-paper-100 p-3">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="请说明需要修改之处"
            rows={2}
            className="rounded-sm border border-ink-300 bg-paper-50 px-2 py-1.5 text-ink-800 text-sm"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => run(requestSuggestionChanges(suggestionId, note))}
            className="self-start rounded-sm bg-brand-700 px-3 py-1.5 font-medium text-paper-50 text-sm hover:bg-brand-800"
          >
            发送修改要求
          </button>
        </div>
      ) : null}

      {rejectOpen ? (
        <div className="flex flex-col gap-2 rounded-sm border border-ink-200 bg-paper-100 p-3">
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="rounded-sm border border-ink-300 bg-paper-50 px-2 py-1.5 text-ink-800 text-sm"
            aria-label="驳回理由"
          >
            <option value="">选择驳回理由…</option>
            {REJECT_REASON_CODES.map((c) => (
              <option key={c} value={c}>
                {REJECT_REASON_LABELS[c]}
              </option>
            ))}
          </select>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="备注（可选）"
            rows={2}
            className="rounded-sm border border-ink-300 bg-paper-50 px-2 py-1.5 text-ink-800 text-sm"
          />
          <button
            type="button"
            disabled={busy || reason === ''}
            onClick={() => run(rejectSuggestion(suggestionId, reason, note))}
            className="self-start rounded-sm bg-accent-700 px-3 py-1.5 font-medium text-paper-50 text-sm hover:bg-accent-800 disabled:opacity-50"
          >
            确认驳回
          </button>
        </div>
      ) : null}
    </div>
  );
}
