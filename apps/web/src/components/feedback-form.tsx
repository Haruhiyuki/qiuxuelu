'use client';

// 编辑建议提交表单（ADR-0010）：选「对全文 / 对某段」。对某段时可直接在原文段落列表里点选，
// 自动回填被评片段并记下锚点（blockId），作者处理时可一键跳回原文。不改博客内容。
import { Alert, Button, Label, Textarea } from '@harublog/ui';
import { ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createFeedback } from '@/server/actions/feedback';

/** 供「指定具体段落」点选的顶层块（由服务端从已发布正文拆出）。 */
export interface DocBlockPick {
  blockId: string;
  kind: string;
  level?: number;
  text: string;
}

const KIND_LABEL: Record<string, string> = {
  paragraph: '正文',
  heading: '标题',
  blockquote: '引用',
  callout: '提示',
  bullet_list: '列表',
  ordered_list: '列表',
  code_block: '代码',
  table: '表格',
  math_block: '公式',
  figure: '图',
};

export function FeedbackForm({
  docId,
  slug,
  title,
  paragraphs,
}: {
  docId: string;
  slug: string;
  title: string;
  paragraphs: DocBlockPick[];
}) {
  const router = useRouter();
  const [scope, setScope] = useState<'whole' | 'fragment'>('whole');
  const [quoted, setQuoted] = useState('');
  const [anchorBlockId, setAnchorBlockId] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const canPick = paragraphs.length > 0;

  function pick(p: DocBlockPick) {
    setAnchorBlockId(p.blockId);
    setQuoted(p.text.slice(0, 500));
    setError(null);
  }

  async function submit() {
    if (body.trim().length === 0) {
      setError('请写下你的意见');
      return;
    }
    setPending(true);
    setError(null);
    const r = await createFeedback(
      docId,
      scope,
      scope === 'fragment' ? quoted : '',
      body,
      scope === 'fragment' ? (anchorBlockId ?? '') : '',
    );
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
            返回博客
          </a>
        </span>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-ink-500 text-sm leading-relaxed">
        编辑建议<strong className="text-ink-700">不会改动博客内容</strong>
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
        <div className="flex flex-col gap-3">
          {canPick ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="fb-picker">在原文中点选要评的段落</Label>
                <a
                  href={`/a/${slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-brand-700 text-xs hover:text-brand-900"
                >
                  新窗口打开原文
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              </div>
              <div
                id="fb-picker"
                className="max-h-72 overflow-auto rounded-md border border-ink-200 bg-paper-50 p-1.5"
              >
                <ul className="flex flex-col gap-0.5">
                  {paragraphs.map((p) => {
                    const active = p.blockId === anchorBlockId;
                    const isHeading = p.kind === 'heading';
                    return (
                      <li key={p.blockId}>
                        <button
                          type="button"
                          onClick={() => pick(p)}
                          aria-pressed={active}
                          className={`flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors ${
                            active ? 'bg-brand-50 ring-1 ring-brand-300' : 'hover:bg-paper-200'
                          } ${isHeading ? 'font-medium text-ink-800' : 'text-ink-600'}`}
                        >
                          <span
                            className={`mt-0.5 shrink-0 rounded-xs px-1 py-px text-[10px] ${
                              active ? 'bg-brand-200 text-brand-900' : 'bg-ink-100 text-ink-500'
                            }`}
                          >
                            {KIND_LABEL[p.kind] ?? '段'}
                          </span>
                          <span className="line-clamp-2">{p.text}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <p className="text-ink-400 text-xs">
                点选后会自动填入下方「被评片段」，可再微调到具体一句；作者处理时能一键跳回原文这一段。
              </p>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fb-quoted">
              被评片段{canPick ? '（已自动填入，可微调）' : '（粘贴原文一句，便于定位）'}
            </Label>
            <Textarea
              id="fb-quoted"
              rows={2}
              maxLength={500}
              value={quoted}
              onChange={(e) => setQuoted(e.target.value)}
              placeholder={
                canPick ? '在上方点选一段，或直接粘贴…' : '把你想评论的那段原文粘贴到这里…'
              }
            />
          </div>
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
