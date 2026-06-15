'use client';

// 移动端导航抽屉：窄屏把板块/写文章/管理 + 账户操作 + 搜索收进汉堡菜单，避免顶栏挤压。
// 自右滑入的 sheet，遮罩点击/Esc/路由切换均关闭，开启时锁背景滚动。桌面端（md+）整体不渲染。
import { Bell, Bookmark, LogIn, Menu, PenLine, Search, Settings, UserRound, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SignOutButton } from './sign-out-button';
import { ThemeToggle } from './theme-toggle';

export interface MobileNavProps {
  loggedIn: boolean;
  userName: string | null;
  userId: string | null;
  unread: number;
  showAdmin: boolean;
  /** 「写文章」目标：已登录 /write，未登录 /login（拒绝变引导） */
  writeHref: string;
}

export function MobileNav(props: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // 路由切换即关闭（点链接跳转后抽屉不应残留）
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // 开启时锁背景滚动 + Esc 关闭 + 焦点落到关闭按钮
  useEffect(() => {
    if (!open) {
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={props.unread > 0 ? `打开菜单（${props.unread} 条未读通知）` : '打开菜单'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        className="-mr-1 relative flex h-9 w-9 items-center justify-center rounded-md text-ink-700 transition-colors hover:bg-paper-200 hover:text-brand-700"
      >
        <Menu className="h-5 w-5" aria-hidden />
        {/* 未读通知红点：不打开菜单也能一眼看到 */}
        {props.loggedIn && props.unread > 0 ? (
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-danger-fill ring-2 ring-paper-100" />
        ) : null}
      </button>

      {/* 抽屉 portal 到 body：header 的 backdrop-blur 会成为定位容器，令 fixed 被困在 56px 高的头部内，
          必须脱离该层叠上下文才能铺满整屏 */}
      {open
        ? createPortal(
            <div
              className="fixed inset-0 z-50 md:hidden"
              role="dialog"
              aria-modal="true"
              id={panelId}
            >
              {/* 遮罩 */}
              <button
                type="button"
                aria-label="关闭菜单"
                onClick={() => setOpen(false)}
                className="overlay-in absolute inset-0 bg-ink-900/30 backdrop-blur-[1px]"
              />
              {/* 抽屉面板 */}
              <div className="drawer-in pt-safe pr-safe absolute inset-y-0 right-0 flex w-[82%] max-w-xs flex-col bg-paper-100 shadow-float">
                <div className="flex items-center justify-between border-ink-200/70 border-b px-4 py-3">
                  <span className="font-medium font-serif text-ink-500 text-sm tracking-wide">
                    菜单
                  </span>
                  <button
                    ref={closeRef}
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="关闭"
                    className="flex h-9 w-9 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-paper-200 hover:text-ink-800"
                  >
                    <X className="h-5 w-5" aria-hidden />
                  </button>
                </div>

                <div className="pb-safe flex-1 overflow-y-auto px-4 py-4">
                  {/* 搜索：关菜单并打开 ⌘K 速搜面板（与桌面同一入口） */}
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      window.dispatchEvent(new CustomEvent('harublog:open-search'));
                    }}
                    className="mb-5 flex h-10 w-full items-center gap-2.5 rounded-full border border-ink-200 bg-paper-50 px-4 text-ink-400 text-sm transition-colors hover:border-brand-300"
                  >
                    <Search className="h-4 w-4" aria-hidden />
                    搜索文章…
                  </button>

                  {/* 写文章：独立填色按钮 + 写作图标，置于导航顶部 */}
                  <Link
                    href={props.writeHref}
                    className="mb-2 inline-flex items-center justify-center gap-1.5 rounded-sm bg-fill px-3 py-2.5 font-medium text-on-fill transition-colors hover:bg-fill-hover"
                  >
                    <PenLine className="h-4 w-4" aria-hidden />
                    写文章
                  </Link>
                  {/* 主导航 */}
                  <nav className="flex flex-col">
                    <DrawerLink href="/news" match="/news" pathname={pathname}>
                      近闻
                    </DrawerLink>
                    <DrawerLink href="/covenant" match="/covenant" pathname={pathname}>
                      公约
                    </DrawerLink>
                    {props.showAdmin ? (
                      <DrawerLink href="/admin" match="/admin" pathname={pathname}>
                        管理
                      </DrawerLink>
                    ) : null}
                  </nav>

                  <div className="my-3 border-ink-200/70 border-t" />

                  {/* 账户 */}
                  {props.loggedIn ? (
                    <nav className="flex flex-col">
                      {props.userId !== null ? (
                        <DrawerLink
                          href={`/u/${props.userId}`}
                          pathname={pathname}
                          icon={<UserRound className="h-[18px] w-[18px]" aria-hidden />}
                        >
                          {props.userName ?? '我的主页'}
                        </DrawerLink>
                      ) : null}
                      <DrawerLink
                        href="/notifications"
                        pathname={pathname}
                        icon={<Bell className="h-[18px] w-[18px]" aria-hidden />}
                      >
                        <span className="flex items-center gap-2">
                          通知
                          {props.unread > 0 ? (
                            <span className="inline-flex min-w-5 justify-center rounded-full bg-danger-fill px-1.5 py-0.5 font-medium text-[11px] text-on-fill leading-none">
                              {props.unread > 99 ? '99+' : props.unread}
                            </span>
                          ) : null}
                        </span>
                      </DrawerLink>
                      <DrawerLink
                        href="/bookmarks"
                        pathname={pathname}
                        icon={<Bookmark className="h-[18px] w-[18px]" aria-hidden />}
                      >
                        收藏
                      </DrawerLink>
                      <DrawerLink
                        href="/account"
                        match="/account"
                        pathname={pathname}
                        icon={<Settings className="h-[18px] w-[18px]" aria-hidden />}
                      >
                        设置
                      </DrawerLink>
                    </nav>
                  ) : (
                    <nav className="flex flex-col gap-2">
                      <DrawerLink
                        href="/login"
                        pathname={pathname}
                        icon={<LogIn className="h-[18px] w-[18px]" aria-hidden />}
                      >
                        登录
                      </DrawerLink>
                      <Link
                        href="/register"
                        className="flex h-11 items-center justify-center rounded-md bg-fill px-4 font-medium text-on-fill shadow-paper transition-colors hover:bg-fill-hover"
                      >
                        注册
                      </Link>
                    </nav>
                  )}

                  {/* 主题 + 退出 */}
                  <div className="mt-4 flex items-center justify-between border-ink-200/70 border-t pt-4">
                    <div className="flex items-center gap-2 text-ink-600 text-sm">
                      <ThemeToggle />
                      <span>外观</span>
                    </div>
                    {props.loggedIn ? <SignOutButton /> : null}
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

// 抽屉内导航项：大触控区（h-11），命中当前路径点亮（朱砂左栏）
function DrawerLink({
  href,
  match,
  pathname,
  icon,
  children,
}: {
  href: string;
  match?: string | string[];
  pathname: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const prefixes =
    match !== undefined ? (Array.isArray(match) ? match : [match]) : [href.split('#')[0] ?? href];
  const active = prefixes.some((p) => p !== '' && (pathname === p || pathname.startsWith(`${p}/`)));
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex h-11 items-center gap-3 rounded-md px-2 text-base transition-colors ${
        active
          ? 'bg-brand-50 font-medium text-brand-800'
          : 'text-ink-700 hover:bg-paper-200 hover:text-ink-900'
      }`}
    >
      {icon !== undefined ? <span className="text-ink-400">{icon}</span> : null}
      {children}
    </Link>
  );
}
