'use client';

// 公示项评议（ADR-0010）：展示赞同度均分 + 评论；登录用户（公共页）可打 1–5 分并评论。
import { Button, Textarea } from '@harublog/ui';
import { Star } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { rateCollabItem } from '@/server/actions/collab-review';
import type { ReviewRow, ReviewSummary } from '@/server/collab-review-read';

function Stars({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <span className="inline-flex" aria-hidden>
      {Array.from({ length: max }, (_, i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${
            i < Math.round(value) ? 'fill-ochre-500 text-ochre-500' : 'text-ink-300'
          }`}
        />
      ))}
    </span>
  );
}

export function CollabReviewWidget({
  targetType,
  targetId,
  canRate,
  summary,
  reviews,
}: {
  targetType: 'feedback' | 'suggestion' | 'revision';
  targetId: string;
  canRate: boolean;
  summary: ReviewSummary | undefined;
  reviews: ReviewRow[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (rating < 1) {
      setError('请先点选 1–5 颗星');
      return;
    }
    setPending(true);
    setError(null);
    const r = await rateCollabItem(targetType, targetId, rating, comment);
    if (r.ok) {
      setOpen(false);
      setComment('');
      router.refresh();
    } else {
      setError(r.error);
      setPending(false);
    }
  }

  const count = summary?.count ?? 0;

  return (
    <div className="mt-3 border-ink-200/70 border-t pt-2">
      <div className="flex flex-wrap items-center gap-2 text-ink-500 text-xs">
        {count > 0 ? (
          <span className="flex items-center gap-1.5">
            <Stars value={summary?.avg ?? 0} />
            <span className="tabular-nums">
              {(summary?.avg ?? 0).toFixed(1)} · {count} 人评议
            </span>
          </span>
        ) : (
          <span>还没有人评议</span>
        )}
        {canRate ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="text-brand-700 transition-colors hover:text-brand-900"
          >
            {open ? '收起' : '我来评议'}
          </button>
        ) : null}
      </div>

      {open && canRate ? (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex items-center gap-1" role="radiogroup" aria-label="赞同度">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                aria-label={`${n} 分`}
                aria-pressed={rating === n}
                className="p-0.5"
              >
                <Star
                  className={`h-5 w-5 ${
                    n <= rating
                      ? 'fill-ochre-500 text-ochre-500'
                      : 'text-ink-300 hover:text-ochre-400'
                  }`}
                />
              </button>
            ))}
            <span className="ml-1 text-ink-400 text-xs">
              {rating > 0 ? `${rating} 分` : '点星打分'}
            </span>
          </div>
          <Textarea
            rows={2}
            maxLength={1000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="说说你的看法（可选）…"
          />
          {error !== null ? <p className="text-accent-700 text-xs">{error}</p> : null}
          <div>
            <Button size="sm" onClick={submit} loading={pending} disabled={pending}>
              提交评议
            </Button>
          </div>
        </div>
      ) : null}

      {reviews.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1.5">
          {reviews
            .filter((r) => r.text !== null && r.text.length > 0)
            .map((r, i) => (
              <li key={`${r.authorName ?? '佚名'}-${i}`} className="text-ink-600 text-xs">
                <span className="inline-flex items-center gap-1 align-middle">
                  <Stars value={r.rating} />
                </span>{' '}
                <span className="font-medium text-ink-700">{r.authorName ?? '佚名'}</span>：{r.text}
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}
