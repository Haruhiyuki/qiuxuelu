'use client';

// 博客评分（赞/踩，Reddit 式净分胶囊）+ 收藏：乐观切换，未登录提示登录。
// 一人一票：点同向取消、点反向改票；展示净分，明细进 title 提示。
import { useToast } from '@harublog/ui';
import { ArrowBigDown, ArrowBigUp, Bookmark, ChevronDown, Eye, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { recordDocView, toggleBookmark, voteDoc } from '@/server/actions/reactions';
import type { DocLiker, VoteDirection } from '@/server/reactions';

export interface ReactionBarProps {
  docId: string;
  initialViewCount: number;
  initialLikeCount: number;
  initialDislikeCount: number;
  initialMyVote: VoteDirection | null;
  initialBookmarked: boolean;
  initialLikers: DocLiker[];
  likerLimit: number;
  loggedIn: boolean;
}

export function ReactionBar({
  docId,
  initialViewCount,
  initialLikeCount,
  initialDislikeCount,
  initialMyVote,
  initialBookmarked,
  initialLikers,
  likerLimit,
  loggedIn,
}: ReactionBarProps) {
  const router = useRouter();
  const toast = useToast();
  const recordedView = useRef(false);
  const [views, setViews] = useState(initialViewCount);
  const [likes, setLikes] = useState(initialLikeCount);
  const [dislikes, setDislikes] = useState(initialDislikeCount);
  const [myVote, setMyVote] = useState<VoteDirection | null>(initialMyVote);
  const [bookmarked, setBookmarked] = useState(initialBookmarked);
  const [likers, setLikers] = useState(initialLikers);
  const [showLikers, setShowLikers] = useState(false);
  const [busy, setBusy] = useState(false);

  const score = likes - dislikes;
  const hiddenLikerCount = Math.max(0, likes - likers.length);

  useEffect(() => {
    if (recordedView.current) {
      return;
    }
    recordedView.current = true;
    void recordDocView(docId).then((r) => {
      if (r.ok) {
        setViews(r.data.viewCount);
      }
    });
  }, [docId]);

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
      setLikers(r.data.likers);
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
    <div id="reactions" className="flex w-full flex-col items-center gap-3">
      <div className="flex flex-wrap items-center justify-center gap-2.5">
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-paper-50 px-3 py-1.5 text-ink-500 text-sm tabular-nums"
          title={`${views} 次阅读`}
        >
          <Eye className="h-4 w-4" aria-hidden />
          <span>{views}</span>
        </span>

        {/* 投票胶囊：↑ 净分 ↓ */}
        <div
          className="inline-flex items-center rounded-full border border-ink-200 bg-paper-50"
          title={`赞 ${likes} · 踩 ${dislikes}`}
        >
          <button
            type="button"
            onClick={() => vote('like')}
            aria-pressed={myVote === 'like'}
            aria-label="赞同这篇博客"
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
            aria-label="不赞同这篇博客"
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
          onClick={() => setShowLikers((v) => !v)}
          aria-expanded={showLikers}
          aria-controls="reaction-likers"
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
            showLikers
              ? 'border-moss-300 bg-moss-50 text-moss-700'
              : 'border-ink-200 text-ink-600 hover:border-moss-300 hover:text-moss-700'
          }`}
        >
          <Users className="h-4 w-4" aria-hidden />
          <span>{likes} 人赞</span>
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${showLikers ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </button>

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

      {showLikers ? (
        <div
          id="reaction-likers"
          className="w-full max-w-md rounded-md border border-ink-200 bg-paper-50 p-3 text-sm shadow-paper"
        >
          {likes === 0 ? (
            <p className="text-center text-ink-400">还没有人点赞</p>
          ) : (
            <>
              <ul className="flex flex-wrap justify-center gap-2">
                {likers.map((liker) => (
                  <li key={liker.id}>
                    <a
                      href={`/u/${liker.id}`}
                      className="inline-flex max-w-40 items-center gap-1.5 rounded-full border border-ink-100 bg-paper-100 py-1 pr-2 pl-1 text-ink-700 transition-colors hover:border-brand-300 hover:text-brand-700"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-100 font-serif text-brand-800 text-xs">
                        {liker.image ? (
                          <img
                            src={liker.image}
                            alt={liker.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          liker.name.charAt(0)
                        )}
                      </span>
                      <span className="truncate">{liker.name}</span>
                    </a>
                  </li>
                ))}
              </ul>
              {hiddenLikerCount > 0 ? (
                <p className="mt-2 text-center text-ink-400 text-xs">
                  另有 {hiddenLikerCount} 位未显示
                </p>
              ) : null}
              {likes > likerLimit ? (
                <p className="sr-only">当前列表最多显示 {likerLimit} 位最近点赞者。</p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
