'use client';

// 「我的系列」页的新建系列表单：建好即跳到该系列的管理页。
import { useToast } from '@harublog/ui';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createSeries } from '@/server/actions/series';

export function CreateSeriesForm() {
  const router = useRouter();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);

  async function onSubmit() {
    const name = title.trim();
    if (name.length === 0) {
      return;
    }
    setPending(true);
    try {
      const r = await createSeries(name, description.trim() || undefined);
      if (!r.ok) {
        toast(r.error, 'error');
        return;
      }
      toast('系列已创建', 'success');
      router.push(`/write/series/${r.data.seriesId}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-xl border border-ink-200 bg-paper-50 p-4 shadow-paper">
      <div className="flex flex-col gap-2.5">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void onSubmit();
            }
          }}
          maxLength={80}
          placeholder="新系列名称"
          className="h-10 rounded-lg border border-ink-200 bg-paper-100 px-3.5 text-ink-900 text-sm placeholder:text-ink-400 focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={300}
          rows={2}
          placeholder="系列简介（选填）"
          className="resize-none rounded-lg border border-ink-200 bg-paper-100 px-3.5 py-2 text-ink-900 text-sm placeholder:text-ink-400 focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
        />
        <button
          type="button"
          onClick={() => void onSubmit()}
          disabled={pending || title.trim().length === 0}
          className="inline-flex h-10 items-center justify-center gap-1.5 self-start rounded-lg bg-fill px-4 font-medium text-on-fill text-sm transition-colors hover:bg-fill-hover disabled:opacity-50"
        >
          <Plus className="h-4 w-4" aria-hidden />
          新建系列
        </button>
      </div>
    </div>
  );
}
