'use client';

import { useConfirm, useToast } from '@harublog/ui';
import { RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { restoreRevision } from '@/server/actions/document';

export interface RestoreButtonProps {
  docId: string;
  revisionId: string;
  seq: number;
  /** 文章是否已发布——决定回退后是否需重新发布才上线（文案据此清晰化）。 */
  published: boolean;
}

/**
 * 把草稿回退到指定历史修订：在草稿分支创建 kind='rollback' 新修订并还原作者工作副本（历史不删）。
 * 回退只动草稿；已发布文章需在写作器重新发布才上线——故成功后直接带去写作器复核/发布，避免「点了没反应」。
 */
export function RestoreButton({ docId, revisionId, seq, published }: RestoreButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  const toast = useToast();

  async function handleClick() {
    const ok = await confirm({
      title: `回退到第 ${seq} 号修订？`,
      description: published
        ? '把草稿还原到该版本的内容（历史保留、不删除）。文章已发布，线上版本暂不变——需在写作器重新发布才会上线。'
        : '把草稿还原到该版本的内容（历史保留、不删除），可继续编辑。',
      confirmLabel: '回退',
    });
    if (!ok) {
      return;
    }
    setPending(true);
    const result = await restoreRevision(docId, revisionId);
    if (result.ok) {
      toast(published ? '草稿已回退，请在写作器复核并重新发布' : '草稿已回退到该版本', 'success');
      // 带去写作器：那里加载的正是刚还原的草稿，可直接复核 / 发布
      router.push(`/write/${docId}`);
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
        className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 px-2.5 py-0.5 text-ink-600 text-xs transition-colors hover:border-accent-300 hover:bg-accent-50 hover:text-accent-700 disabled:opacity-50"
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        {pending ? '回退中…' : '回退到此版本'}
      </button>
    </span>
  );
}
