'use client';

// 草稿箱删除按钮：确认后删除草稿/待审稿（deleteDocument 仅允许未发布稿），刷新列表。
import { useConfirm, useToast } from '@harublog/ui';
import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { deleteDocument } from '@/server/actions/document';

export function DeleteDraftButton({ docId, title }: { docId: string; title: string }) {
  const router = useRouter();
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [pending, setPending] = useState(false);

  async function onDelete() {
    const ok = await confirm({
      title: `删除《${title}》？`,
      description: '草稿及其编辑历史将被永久删除，不可撤销。',
      danger: true,
      confirmLabel: '删除',
    });
    if (!ok) {
      return;
    }
    setPending(true);
    try {
      const r = await deleteDocument(docId);
      if (!r.ok) {
        toast(r.error, 'error');
        return;
      }
      toast('已删除', 'success');
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void onDelete()}
        disabled={pending}
        aria-label={`删除草稿《${title}》`}
        className="inline-flex items-center gap-1 text-ink-400 transition-colors hover:text-accent-700 disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" aria-hidden />
        删除
      </button>
      {confirmDialog}
    </>
  );
}
