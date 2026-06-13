'use client';

// AI 拦下评论的复核操作：放行（误判）/ 删除（确认拦截）。调用服务端动作后刷新队列。
import { Button } from '@harublog/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { rejectHeldComment, releaseHeldComment } from '@/server/actions/comment';

export function HeldCommentActions({ commentId }: { commentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'release' | 'reject'>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: 'release' | 'reject') {
    setBusy(kind);
    setError(null);
    const r =
      kind === 'release' ? await releaseHeldComment(commentId) : await rejectHeldComment(commentId);
    if (r.ok) {
      router.refresh();
    } else {
      setError(r.error);
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" onClick={() => run('release')} disabled={busy !== null}>
        {busy === 'release' ? '放行中…' : '放行'}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => run('reject')}
        disabled={busy !== null}
      >
        {busy === 'reject' ? '删除中…' : '删除'}
      </Button>
      {error !== null ? <span className="text-accent-700 text-xs">{error}</span> : null}
    </div>
  );
}
