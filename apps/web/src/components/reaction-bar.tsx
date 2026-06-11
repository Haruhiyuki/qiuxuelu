'use client';

// 文章点赞 / 收藏条：乐观切换，未登录提示登录。
import { useToast } from '@harublog/ui';
import { Bookmark, Heart } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toggleReaction } from '@/server/actions/reactions';

export interface ReactionBarProps {
  docId: string;
  initialLikeCount: number;
  initialLiked: boolean;
  initialBookmarked: boolean;
  loggedIn: boolean;
}

export function ReactionBar({
  docId,
  initialLikeCount,
  initialLiked,
  initialBookmarked,
  loggedIn,
}: ReactionBarProps) {
  const router = useRouter();
  const toast = useToast();
  const [liked, setLiked] = useState(initialLiked);
  const [likeCount, setLikeCount] = useState(initialLikeCount);
  const [bookmarked, setBookmarked] = useState(initialBookmarked);
  const [busy, setBusy] = useState(false);

  async function toggle(kind: 'like' | 'bookmark') {
    if (!loggedIn) {
      toast('请先登录', 'info');
      router.push('/login');
      return;
    }
    if (busy) {
      return;
    }
    setBusy(true);
    // 乐观更新
    if (kind === 'like') {
      setLiked((v) => !v);
      setLikeCount((n) => n + (liked ? -1 : 1));
    } else {
      setBookmarked((v) => !v);
    }
    const r = await toggleReaction(docId, kind);
    if (r.ok) {
      if (kind === 'like') {
        setLiked(r.data.active);
        setLikeCount(r.data.count);
      } else {
        setBookmarked(r.data.active);
        if (r.data.active) {
          toast('已加入收藏', 'success');
        }
      }
    } else {
      // 回滚
      if (kind === 'like') {
        setLiked(liked);
        setLikeCount(likeCount);
      } else {
        setBookmarked(bookmarked);
      }
      toast(r.error, 'error');
    }
    setBusy(false);
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => toggle('like')}
        aria-pressed={liked}
        className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm transition-colors ${
          liked
            ? 'border-accent-300 bg-accent-50 text-accent-700'
            : 'border-ink-200 text-ink-600 hover:border-ink-300'
        }`}
      >
        <Heart className="h-4 w-4" fill={liked ? 'currentColor' : 'none'} aria-hidden />
        <span>{likeCount > 0 ? likeCount : '赞'}</span>
      </button>
      <button
        type="button"
        onClick={() => toggle('bookmark')}
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
