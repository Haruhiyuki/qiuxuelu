'use client';

// 编辑建议处理（权限者）：选处理状态 + 回复，提交后刷新。
import { Button, Textarea } from '@harublog/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { handleFeedback } from '@/server/actions/feedback';

const OPTIONS = [
  { value: 'accepted', label: '采纳' },
  { value: 'declined', label: '不采纳' },
  { value: 'resolved', label: '已处理' },
] as const;

export function FeedbackHandle({ feedbackId }: { feedbackId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<string>('accepted');
  const [reply, setReply] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);
    const r = await handleFeedback(feedbackId, status, reply);
    if (r.ok) {
      router.refresh();
    } else {
      setError(r.error);
      setPending(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2 border-ink-200/70 border-t pt-3">
      <div className="flex flex-wrap items-center gap-2">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => setStatus(o.value)}
            aria-pressed={status === o.value}
            className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
              status === o.value
                ? 'border-brand-400 bg-brand-50 font-medium text-brand-800'
                : 'border-ink-200 text-ink-500 hover:border-brand-300'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <Textarea
        rows={2}
        maxLength={2000}
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        placeholder="回复建议人（可选）…"
      />
      {error !== null ? <p className="text-accent-700 text-xs">{error}</p> : null}
      <div>
        <Button size="sm" onClick={submit} loading={pending} disabled={pending}>
          提交处理
        </Button>
      </div>
    </div>
  );
}
