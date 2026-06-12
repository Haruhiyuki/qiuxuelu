'use client';

// 文章评分（赞/踩，Reddit 式净分胶囊）+ 收藏：乐观切换，未登录提示登录。
// 一人一票：点同向取消、点反向改票；展示净分，明细进 title 提示。
import { useToast } from '@harublog/ui';
import { ArrowBigDown, ArrowBigUp, Bookmark } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toggleBookmark, voteDoc } from '@/server/actions/reactions';
import type { VoteDirection } from '@/server/reactions';

export interface ReactionBarProps {
  docId: string;
  initialLikeCount: number;
  initialDislikeCount: number;
  initialMyVote: VoteDirection | null;
  initialBookmarked: boolean;
  loggedIn: boolean;
}

export function ReactionBar({
  docId,
  initialLikeCount,
  initialDislikeCount,
  initialMyVote,
  initialBookmarked,
  loggedIn,
}: ReactionBarProps) {
  const router = useRouter();
  const toast = useToast();
  const [likes, setLikes] = useState(initialLikeCount);
  const [dislikes, setDislikes] = useState(initialDislikeCount);
  const [myVote, setMyVote] = useState<VoteDirection | null>(initialMyVote);
  const [bookmarked, setBookmarked] = useState(initialBookmarked);
  const [busy, setBusy] = useState(false);

  const score = likes - dislikes;

  async function vote(direction: VoteDirection) {
    if (!loggedIn) {
      toast('请先登录', 'info');
      router.push('/login');
      return;
    }
    if (busy) {
      return;
    }
    setBusy(true);
    // 乐观更新：先按本地状态推演投票结果
    const prev = { likes, dislikes, myVote };
    if (myVote === direction) {
      // 取消投票
      if (direction === 'like') {
        setLikes((n) => n - 1);
      } else {
        setDislikes((n) => n - 1);
      }
      setMyVote(null);
    } else {
      if (direction === 'like') {
        setLikes((n) => n + 1);
        if (myVote === 'dislike') {
          setDislikes((n) => n - 1);
        }
      } else {
        setDislikes((n) => n + 1);
        if (myVote === 'like') {
          setLikes((n) => n - 1);
        }
      }
      setMyVote(direction);
    }
    const r = await voteDoc(docId, direction);
    if (r.ok) {
      // 以服务端计数为准校正
      setLikes(r.data.likeCount);
      setDislikes(r.data.dislikeCount);
      setMyVote(r.data.myVote);
    } else {
      setLikes(prev.likes);
      setDislikes(prev.dislikes);
      setMyVote(prev.myVote);
      toast(r.error, 'error');
    }
    setBusy(false);
  }

  async function bookmark() {
    if (!loggedIn) {
      toast('请先登录', 'info');
      router.push('/login');
      return;
    }
    if (busy) {
      return;
    }
    setBusy(true);
    const prev = bookmarked;
    setBookmarked(!prev);
    const r = await toggleBookmark(docId);
    if (r.ok) {
      setBookmarked(r.data.active);
      if (r.data.active) {
        toast('已加入收藏', 'success');
      }
    } else {
      setBookmarked(prev);
      toast(r.error, 'error');
    }
    setBusy(false);
  }

  return (
    <div className="flex items-center gap-3">
      {/* 投票胶囊：↑ 净分 ↓ */}
      <div
        className="inline-flex items-center rounded-full border border-ink-200 bg-paper-50"
        title={`赞 ${likes} · 踩 ${dislikes}`}
      >
        <button
          type="button"
          onClick={() => vote('like')}
          aria-pressed={myVote === 'like'}
          aria-label="赞同这篇文章"
          className={`group rounded-l-full py-1.5 pr-1.5 pl-3 transition-colors ${
            myVote === 'like' ? 'text-moss-600' : 'text-ink-400 hover:text-moss-600'
          }`}
        >
          <ArrowBigUp
            className="h-5 w-5 transition-transform group-hover:-translate-y-0.5"
            fill={myVote === 'like' ? 'currentColor' : 'none'}
            aria-hidden
          />
        </button>
        <span
          className={`min-w-7 text-center font-medium text-sm tabular-nums ${
            myVote === 'like'
              ? 'text-moss-700'
              : myVote === 'dislike'
                ? 'text-accent-700'
                : 'text-ink-700'
          }`}
        >
          <span className="sr-only">当前评分：</span>
          {score}
        </span>
        <button
          type="button"
          onClick={() => vote('dislike')}
          aria-pressed={myVote === 'dislike'}
          aria-label="不赞同这篇文章"
          className={`group rounded-r-full py-1.5 pr-3 pl-1.5 transition-colors ${
            myVote === 'dislike' ? 'text-accent-600' : 'text-ink-400 hover:text-accent-600'
          }`}
        >
          <ArrowBigDown
            className="h-5 w-5 transition-transform group-hover:translate-y-0.5"
            fill={myVote === 'dislike' ? 'currentColor' : 'none'}
            aria-hidden
          />
        </button>
      </div>

      <button
        type="button"
        onClick={bookmark}
        aria-pressed={bookmarked}
        aria-label={bookmarked ? '取消收藏' : '收藏'}
        className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm transition-colors ${
          bookmarked
            ? 'border-brand-300 bg-brand-50 text-brand-700'
            : 'border-ink-200 text-ink-600 hover:border-ink-300'
        }`}
      >
        <Bookmark className="h-4 w-4" fill={bookmarked ? 'currentColor' : 'none'} aria-hidden />
        <span>{bookmarked ? '已收藏' : '收藏'}</span>
      </button>
    </div>
  );
}
