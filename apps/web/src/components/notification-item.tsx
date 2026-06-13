'use client';

// 单条通知：点进去即把自己标为已读（乐观置灰圆点，后台 fire-and-forget 落库）。
// 链接均为站内 SPA 跳转，React 树不卸载，server action 的 POST 会跑完，不会被导航打断。
import Link from 'next/link';
import { useState } from 'react';
import { markNotificationRead } from '@/server/actions/notification';

export function NotificationItem({
  id,
  href,
  text,
  time,
  iso,
  unread,
}: {
  id: string;
  href: string;
  text: string;
  time: string;
  iso: string;
  unread: boolean;
}) {
  const [read, setRead] = useState(!unread);

  function handleClick() {
    if (read) {
      return;
    }
    setRead(true); // 乐观：圆点立刻置灰
    void markNotificationRead(id); // 不 await：站内跳转不卸载，请求自会完成
  }

  return (
    <li className="flex items-start gap-3 py-4">
      <span
        className={`mt-1.5 size-2 shrink-0 rounded-full transition-colors ${
          read ? 'bg-ink-200' : 'bg-danger-fill'
        }`}
        aria-hidden
      />
      <div className="flex flex-col gap-0.5">
        <Link
          href={href}
          onClick={handleClick}
          className="text-ink-800 text-sm transition-colors hover:text-brand-700"
        >
          {text}
        </Link>
        <time dateTime={iso} className="text-ink-400 text-xs">
          {time}
        </time>
      </div>
    </li>
  );
}
