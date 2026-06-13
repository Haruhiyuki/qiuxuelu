'use client';

import { useConfirm, useToast } from '@harublog/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { patrolApprove, patrolRevert } from '@/server/actions/patrol';

export function PatrolPanel({ revisionId }: { revisionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  const toast = useToast();

  async function approve() {
    setBusy(true);
    const r = await patrolApprove(revisionId);
    if (r.ok) {
      toast('已标记为已巡查', 'success');
      router.refresh();
    } else {
      toast(r.error, 'error');
      setBusy(false);
    }
  }
  async function revert() {
    const ok = await confirm({
      title: '回退这次修订？',
      description: '将创建一个还原到改前内容的新修订（历史保留）。',
      confirmLabel: '回退',
      danger: true,
    });
    if (!ok) {
      return;
    }
    setBusy(true);
    const r = await patrolRevert(revisionId);
    if (r.ok) {
      toast('已回退该编辑', 'success');
      router.refresh();
    } else {
      toast(r.error, 'error');
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      {confirmDialog}
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
          className="rounded-sm bg-danger-fill px-3 py-1.5 font-medium text-on-fill text-sm hover:bg-danger-fill-hover disabled:opacity-50"
        >
          回退此编辑
        </button>
      </div>
    </div>
  );
}
