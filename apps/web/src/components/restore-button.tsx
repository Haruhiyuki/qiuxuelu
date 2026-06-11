'use client';

import { useConfirm, useToast } from '@harublog/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { restoreRevision } from '@/server/actions/document';

export interface RestoreButtonProps {
  docId: string;
  revisionId: string;
  seq: number;
}

/** 回滚到指定历史修订：在草稿分支创建一个还原内容的新修订（不删历史）。 */
export function RestoreButton({ docId, revisionId, seq }: RestoreButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  const toast = useToast();

  async function handleClick() {
    const ok = await confirm({
      title: `回滚到第 ${seq} 号修订？`,
      description: '将创建一个还原该内容的新草稿修订，历史不会被删除。',
      confirmLabel: '回滚',
    });
    if (!ok) {
      return;
    }
    setPending(true);
    const result = await restoreRevision(docId, revisionId);
    if (result.ok) {
      toast('已回滚到该版本', 'success');
      router.refresh();
    } else {
      toast(result.error, 'error');
      setPending(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {confirmDialog}
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="text-ink-500 underline decoration-ink-300 underline-offset-2 hover:text-accent-700 disabled:opacity-50"
      >
        {pending ? '回滚中…' : '回滚到此版本'}
      </button>
    </span>
  );
}
