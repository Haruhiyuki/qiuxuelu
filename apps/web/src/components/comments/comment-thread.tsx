'use client';

import { usePrompt, useToast } from '@harublog/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FlagButton } from '@/components/flag-button';
import { hideComment } from '@/server/actions/comment';
import { CommentForm } from './comment-form';
import { MentionText } from './mention-text';

export interface CommentView {
  id: string;
  authorName: string;
  text: string;
  createdAtLabel: string;
}

export interface CommentThreadProps {
  docId: string;
  comment: CommentView;
  replies: CommentView[];
  canReply: boolean;
  canModerate: boolean;
}

function HideButton({ commentId }: { commentId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const { prompt, promptDialog } = usePrompt();
  const toast = useToast();
  async function handleHide() {
    const reason = await prompt({
      title: '隐藏该评论',
      label: '隐藏理由（将记入审计）',
      placeholder: '例如：含人身攻击',
      multiline: true,
      required: true,
      confirmLabel: '隐藏',
    });
    if (reason === null || reason.length === 0) {
      return;
    }
    setPending(true);
    const result = await hideComment(commentId, reason);
    if (result.ok) {
      toast('评论已隐藏', 'success');
      router.refresh();
    } else {
      toast(result.error, 'error');
      setPending(false);
    }
  }
  return (
    <>
      {promptDialog}
      <button
        type="button"
        onClick={handleHide}
        disabled={pending}
        className="text-xs text-ink-400 hover:text-accent-700 disabled:opacity-50"
      >
        {pending ? '处理中…' : '隐藏'}
      </button>
    </>
  );
}

function CommentBody({
  view,
  canModerate,
  canFlag,
}: {
  view: CommentView;
  canModerate: boolean;
  canFlag: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium text-ink-800">{view.authorName}</span>
        <span className="text-ink-400">{view.createdAtLabel}</span>
        {canModerate ? <HideButton commentId={view.id} /> : null}
        {canFlag ? <FlagButton subjectType="comment" subjectId={view.id} /> : null}
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink-700">
        <MentionText text={view.text} />
      </p>
    </div>
  );
}

export function CommentThread({
  docId,
  comment,
  replies,
  canReply,
  canModerate,
}: CommentThreadProps) {
  const [replying, setReplying] = useState(false);
  return (
    <li className="py-5">
      <CommentBody view={comment} canModerate={canModerate} canFlag={canReply} />
      <div className="mt-2 flex items-center gap-3 text-xs">
        {canReply ? (
          <button
            type="button"
            onClick={() => setReplying((v) => !v)}
            className="text-ink-500 hover:text-brand-700"
          >
            {replying ? '收起' : '回复'}
          </button>
        ) : null}
      </div>
      {replying ? (
        <div className="mt-3 border-l-2 border-ink-100 pl-4">
          <CommentForm
            docId={docId}
            parentId={comment.id}
            compact
            placeholder={`回复 ${comment.authorName}…`}
            onDone={() => setReplying(false)}
          />
        </div>
      ) : null}
      {replies.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-4 border-l-2 border-ink-100 pl-4">
          {replies.map((reply) => (
            <li key={reply.id}>
              <CommentBody view={reply} canModerate={canModerate} canFlag={canReply} />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
