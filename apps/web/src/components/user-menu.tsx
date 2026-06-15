'use client';

// 桌面页头的「个人资料」用户菜单：头像+名字为触发，悬停（或点击/聚焦）浮出弹窗，
// 内含 我的主页 / 通知 / 收藏 / 退出。悬停桥（弹窗 pt-2 间距仍属同一子树）保证移入不闪关；
// Escape 与点击外部关闭。移动端不渲染（窄屏走汉堡抽屉）。
import { Bell, Bookmark, ChevronDown, LogOut, Settings, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { authClient } from '@/lib/auth-client';

interface UserMenuProps {
  userId: string;
  userName: string;
  userImage: string | null;
  unread: number;
}

export function UserMenu({ userId, userName, userImage, unread }: UserMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current !== null && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  async function signOut() {
    setPending(true);
    await authClient.signOut();
    router.refresh();
    setPending(false);
    setOpen(false);
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 悬停仅为鼠标增强；键盘/触摸经触发按钮（点击/聚焦）与 Esc 已可达
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onFocus={() => setOpen(true)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="个人资料菜单"
        className="flex items-center gap-1.5 rounded-full py-0.5 pr-1.5 pl-0.5 text-ink-800 transition-colors hover:text-brand-700"
      >
        <span className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-brand-100 font-medium font-serif text-brand-700 text-sm ring-1 ring-ink-200">
          {userImage !== null ? (
            <img src={userImage} alt="" className="h-full w-full object-cover" />
          ) : (
            userName.slice(0, 1)
          )}
          {/* 未读红点：菜单收起时也能一眼看到 */}
          {unread > 0 ? (
            <span className="-top-0.5 -right-0.5 absolute h-2.5 w-2.5 rounded-full bg-danger-fill ring-2 ring-paper-100" />
          ) : null}
        </span>
        <span className="max-w-[8rem] truncate font-medium text-sm">{userName}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open ? (
        // pt-2 充当悬停桥：视觉留间距，但仍属本子树，鼠标移入弹窗不触发 mouseleave
        <div className="absolute top-full right-0 z-50 pt-2">
          <div
            role="menu"
            className="pop-in w-52 overflow-hidden rounded-xl border border-ink-200 bg-paper-50 py-1.5 shadow-float"
          >
            <MenuLink
              href={`/u/${userId}`}
              icon={<UserRound className="h-4 w-4" aria-hidden />}
              onSelect={() => setOpen(false)}
            >
              我的主页
            </MenuLink>
            <MenuLink
              href="/notifications"
              icon={<Bell className="h-4 w-4" aria-hidden />}
              onSelect={() => setOpen(false)}
            >
              <span className="flex flex-1 items-center justify-between gap-2">
                通知
                {unread > 0 ? (
                  <span className="inline-flex min-w-5 justify-center rounded-full bg-danger-fill px-1.5 py-0.5 font-medium text-[11px] text-on-fill leading-none">
                    {unread > 99 ? '99+' : unread}
                  </span>
                ) : null}
              </span>
            </MenuLink>
            <MenuLink
              href="/bookmarks"
              icon={<Bookmark className="h-4 w-4" aria-hidden />}
              onSelect={() => setOpen(false)}
            >
              收藏
            </MenuLink>
            <MenuLink
              href="/account"
              icon={<Settings className="h-4 w-4" aria-hidden />}
              onSelect={() => setOpen(false)}
            >
              设置
            </MenuLink>
            <div className="my-1 border-ink-100 border-t" />
            <button
              type="button"
              role="menuitem"
              onClick={() => void signOut()}
              disabled={pending}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-ink-600 text-sm transition-colors hover:bg-paper-200 hover:text-accent-700 disabled:opacity-50"
            >
              <LogOut className="h-4 w-4 text-ink-400" aria-hidden />
              退出登录
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({
  href,
  icon,
  children,
  onSelect,
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
  onSelect: () => void;
}) {
  return (
    <Link
      role="menuitem"
      href={href}
      onClick={onSelect}
      className="flex items-center gap-2.5 px-3.5 py-2 text-ink-700 text-sm transition-colors hover:bg-paper-200 hover:text-brand-700"
    >
      <span className="text-ink-400">{icon}</span>
      {children}
    </Link>
  );
}
