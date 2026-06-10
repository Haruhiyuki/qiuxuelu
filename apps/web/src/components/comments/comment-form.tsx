'use client';

import { Button, Textarea } from '@harublog/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createComment } from '@/server/actions/comment';

export interface CommentFormProps {
  docId: string;
  /** 提供则为回复某顶层评论；缺省为发表顶层评论。 */
  parentId?: string;
  placeholder?: string;
  onDone?: () => void;
  compact?: boolean;
}

export function CommentForm({ docId, parentId, placeholder, compact, onDone }: CommentFormProps) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (text.trim().length === 0) {
      setError('评论内容不能为空');
      return;
    }
    setPending(true);
    setError(null);
    const result = await createComment(docId, text, parentId);
    if (result.ok) {
      setText('');
      onDone?.();
      router.refresh();
    } else {
      setError(result.error);
    }
    setPending(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder ?? '写下你的看法或补充…'}
        rows={compact ? 2 : 3}
        disabled={pending}
      />
      {error !== null ? <p className="text-sm text-accent-700">{error}</p> : null}
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" onClick={handleSubmit} disabled={pending}>
          {pending ? '提交中…' : parentId ? '回复' : '发表评论'}
        </Button>
        {parentId && onDone ? (
          <button
            type="button"
            onClick={onDone}
            className="text-sm text-ink-500 hover:text-ink-700"
          >
            取消
          </button>
        ) : null}
      </div>
    </div>
  );
}
