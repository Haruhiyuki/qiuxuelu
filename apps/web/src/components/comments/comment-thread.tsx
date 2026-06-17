'use client';

import { usePrompt, useToast } from '@harublog/ui';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FlagButton } from '@/components/flag-button';
import { hideComment } from '@/server/actions/comment';
import { voteComment } from '@/server/actions/reactions';
import type { VoteDirection } from '@/server/reactions';
import { CommentForm } from './comment-form';
import { MentionText } from './mention-text';

export interface CommentView {
  id: string;
  authorName: string;
  text: string;
  createdAtLabel: string;
  likeCount: number;
  dislikeCount: number;
  myVote: VoteDirection | null;
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

/** 评论赞/踩：乐观切换，未登录引导登录；计数为 0 时只显图标。 */
function CommentReactions({
  commentId,
  likeCount,
  dislikeCount,
  myVote,
  loggedIn,
}: {
  commentId: string;
  likeCount: number;
  dislikeCount: number;
  myVote: VoteDirection | null;
  loggedIn: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [likes, setLikes] = useState(likeCount);
  const [dislikes, setDislikes] = useState(dislikeCount);
  const [vote, setVote] = useState<VoteDirection | null>(myVote);
  const [busy, setBusy] = useState(false);

  async function handle(dir: VoteDirection) {
    if (!loggedIn) {
      toast('请先登录', 'info');
      router.push('/login');
      return;
    }
    if (busy) {
      return;
    }
    setBusy(true);
    const prev = { likes, dislikes, vote };
    // 乐观推演
    if (vote === dir) {
      if (dir === 'like') {
        setLikes((n) => n - 1);
      } else {
        setDislikes((n) => n - 1);
      }
      setVote(null);
    } else {
      if (dir === 'like') {
        setLikes((n) => n + 1);
        if (vote === 'dislike') {
          setDislikes((n) => n - 1);
        }
      } else {
        setDislikes((n) => n + 1);
        if (vote === 'like') {
          setLikes((n) => n - 1);
        }
      }
      setVote(dir);
    }
    const r = await voteComment(commentId, dir);
    if (r.ok) {
      setLikes(r.data.likeCount);
      setDislikes(r.data.dislikeCount);
      setVote(r.data.myVote);
    } else {
      setLikes(prev.likes);
      setDislikes(prev.dislikes);
      setVote(prev.vote);
      toast(r.error, 'error');
    }
    setBusy(false);
  }

  return (
    <div className="mt-1.5 flex items-center gap-3 text-xs">
      <button
        type="button"
        onClick={() => handle('like')}
        aria-pressed={vote === 'like'}
        aria-label="赞"
        className={`inline-flex items-center gap-1 tabular-nums transition-colors ${
          vote === 'like' ? 'text-brand-700' : 'text-ink-400 hover:text-brand-700'
        }`}
      >
        <ThumbsUp className="h-3.5 w-3.5" aria-hidden />
        {likes > 0 ? likes : ''}
      </button>
      <button
        type="button"
        onClick={() => handle('dislike')}
        aria-pressed={vote === 'dislike'}
        aria-label="踩"
        className={`inline-flex items-center gap-1 tabular-nums transition-colors ${
          vote === 'dislike' ? 'text-accent-700' : 'text-ink-400 hover:text-accent-700'
        }`}
      >
        <ThumbsDown className="h-3.5 w-3.5" aria-hidden />
        {dislikes > 0 ? dislikes : ''}
      </button>
    </div>
  );
}

function CommentBody({
  view,
  canModerate,
  canFlag,
  loggedIn,
}: {
  view: CommentView;
  canModerate: boolean;
  canFlag: boolean;
  loggedIn: boolean;
}) {
  return (
    <div className="flex gap-3">
      <span
        aria-hidden
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-100 font-serif text-brand-800 text-xs"
      >
        {view.authorName.charAt(0)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-ink-800">{view.authorName}</span>
          <span className="text-ink-400 text-xs">{view.createdAtLabel}</span>
          {canModerate ? <HideButton commentId={view.id} /> : null}
          {canFlag ? <FlagButton subjectType="comment" subjectId={view.id} /> : null}
        </div>
        <p className="mt-1 whitespace-pre-wrap text-ink-700 text-sm leading-relaxed">
          <MentionText text={view.text} />
        </p>
        <CommentReactions
          commentId={view.id}
          likeCount={view.likeCount}
          dislikeCount={view.dislikeCount}
          myVote={view.myVote}
          loggedIn={loggedIn}
        />
      </div>
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
      <CommentBody
        view={comment}
        canModerate={canModerate}
        canFlag={canReply}
        loggedIn={canReply}
      />
      <div className="mt-2 flex items-center gap-3 pl-10 text-xs">
        {canReply ? (
          <button
            type="button"
            onClick={() => setReplying((v) => !v)}
            className="text-ink-500 transition-colors hover:text-brand-700"
          >
            {replying ? '收起' : '回复'}
          </button>
        ) : null}
      </div>
      {/* 嵌套线从头像正下方穿过（头像宽 28px，线缩进至其中线） */}
      {replying ? (
        <div className="mt-3 ml-3.5 border-ink-200 border-l-2 pl-6">
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
        <ul className="mt-4 ml-3.5 flex flex-col gap-4 border-ink-200 border-l-2 pl-6">
          {replies.map((reply) => (
            <li key={reply.id}>
              <CommentBody
                view={reply}
                canModerate={canModerate}
                canFlag={canReply}
                loggedIn={canReply}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
