'use client';

// 编辑建议提交表单（ADR-0010）：选「对全文 / 对某段」，可粘贴被评片段，写意见。不改文章内容。
import { Alert, Button, Label, Textarea } from '@harublog/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createFeedback } from '@/server/actions/feedback';

export function FeedbackForm({
  docId,
  slug,
  title,
}: {
  docId: string;
  slug: string;
  title: string;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<'whole' | 'fragment'>('whole');
  const [quoted, setQuoted] = useState('');
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    if (body.trim().length === 0) {
      setError('请写下你的意见');
      return;
    }
    setPending(true);
    setError(null);
    const r = await createFeedback(docId, scope, scope === 'fragment' ? quoted : '', body);
    if (r.ok) {
      setDone(true);
    } else {
      setError(r.error);
      setPending(false);
    }
  }

  if (done) {
    return (
      <Alert variant="info">
        已提交，谢谢你的意见——它已送到作者与编辑后台，处理后你会收到通知。
        <span className="ml-2">
          <a href={`/a/${slug}`} className="text-brand-700 underline underline-offset-2">
            返回文章
          </a>
        </span>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-ink-500 text-sm leading-relaxed">
        编辑建议<strong className="text-ink-700">不会改动文章内容</strong>
        ，只是把你的意见送给作者与编辑参考；他们处理后会回复并标注处理状态。
      </p>

      {error !== null ? <Alert variant="danger">{error}</Alert> : null}

      <fieldset className="flex items-center gap-2 text-sm" aria-label="建议范围">
        {(
          [
            ['whole', '对全文'],
            ['fragment', '对某段'],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => setScope(v)}
            aria-pressed={scope === v}
            className={`rounded-full border px-3 py-1 transition-colors ${
              scope === v
                ? 'border-brand-400 bg-brand-50 font-medium text-brand-800'
                : 'border-ink-200 text-ink-600 hover:border-brand-300'
            }`}
          >
            {label}
          </button>
        ))}
      </fieldset>

      {scope === 'fragment' ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fb-quoted">被评片段（粘贴原文一句，便于定位）</Label>
          <Textarea
            id="fb-quoted"
            rows={2}
            maxLength={500}
            value={quoted}
            onChange={(e) => setQuoted(e.target.value)}
            placeholder="把你想评论的那段原文粘贴到这里…"
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="fb-body">你的意见</Label>
        <Textarea
          id="fb-body"
          rows={5}
          maxLength={2000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="例如：开头建议补一句背景；第三节的例子可以换成更贴近高中的…"
        />
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={submit} loading={pending} disabled={pending}>
          提交编辑建议
        </Button>
        <Button variant="ghost" onClick={() => router.push(`/a/${slug}`)} disabled={pending}>
          取消
        </Button>
      </div>
      <p className="text-ink-400 text-xs">关于《{title}》</p>
    </div>
  );
}
