'use client';

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
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (
      !window.confirm(
        `确认回滚到第 ${seq} 号修订？将创建一个还原该内容的新草稿修订，历史不会被删除。`,
      )
    ) {
      return;
    }
    setPending(true);
    setError(null);
    const result = await restoreRevision(docId, revisionId);
    if (result.ok) {
      router.refresh();
    } else {
      setError(result.error);
      setPending(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="text-ink-500 underline decoration-ink-300 underline-offset-2 hover:text-accent-700 disabled:opacity-50"
      >
        {pending ? '回滚中…' : '回滚到此版本'}
      </button>
      {error !== null ? <span className="text-accent-700">{error}</span> : null}
    </span>
  );
}
