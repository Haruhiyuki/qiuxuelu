import { SITE_NAME } from '@harublog/config';
import { getDb } from '@harublog/db';
import { Bell, Search } from 'lucide-react';
import Link from 'next/link';
import { getSession } from '@/lib/session';
import { hasPublishGrant, loadActor } from '@/server/actors';
import { hasConsented } from '@/server/consent';
import { countUnread } from '@/server/notifications';
import { NavLink } from './nav-link';
import { SignOutButton } from './sign-out-button';
import { ThemeToggle } from './theme-toggle';

export async function SiteHeader() {
  const session = await getSession();
  // 管理入口仅对持有任一治理角色者可见（权限显隐；各后台页仍有服务端守卫）
  let showAdmin = false;
  let unread = 0;
  let needConsent = false;
  if (session) {
    const actor = await loadActor(session.user.id);
    showAdmin = actor !== null && (hasPublishGrant(actor) || actor.roles.length > 0);
    unread = await countUnread(getDb(), session.user.id);
    needConsent = !(await hasConsented(session.user.id));
  }

  return (
    <header className="sticky top-0 z-40 border-ink-200/80 border-b bg-paper-100/90 backdrop-blur-md">
      {needConsent ? (
        <div className="border-ochre-200 border-b bg-ochre-50 text-center text-ochre-900 text-sm">
          <div className="mx-auto max-w-6xl px-4 py-2">
            还差一步：
            <Link href="/onboarding/consent" className="font-medium underline underline-offset-2">
              确认内容授权与社区公约
            </Link>
            后即可发布、评论与提交建议。
          </div>
        </div>
      ) : null}
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-4 sm:gap-8">
          <Link href="/" className="group flex shrink-0 items-center gap-2.5">
            {/* 朱印式站标：方印底 + 站名首字，呼应「纸页与批注」的朱砂 */}
            <span
              aria-hidden
              className="flex h-7 w-7 items-center justify-center rounded-xs bg-danger-fill font-serif text-base text-on-fill leading-none shadow-paper transition-transform group-hover:-rotate-3"
            >
              {SITE_NAME.charAt(0)}
            </span>
            <span className="whitespace-nowrap font-semibold font-serif text-ink-900 text-xl tracking-wide">
              {SITE_NAME}
            </span>
          </Link>
          <nav className="flex items-center gap-3 text-sm sm:gap-6">
            <NavLink href="/#sections" match="/s">
              板块
            </NavLink>
            {/* 未登录也显示入口，点击跳登录（拒绝变引导） */}
            <NavLink href={session ? '/write' : '/login'} match="/write">
              写文章
            </NavLink>
            {showAdmin ? (
              <NavLink href="/admin" match="/admin">
                管理
              </NavLink>
            ) : null}
          </nav>
        </div>
        <form method="get" action="/search" className="relative hidden md:block">
          <Search
            aria-hidden
            className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 text-ink-400"
          />
          <input
            type="search"
            name="q"
            placeholder="搜索文章…"
            aria-label="搜索"
            className="h-8 w-44 rounded-full border border-ink-200 bg-paper-50 pr-3 pl-8 text-ink-800 text-sm transition-[width,border-color] duration-200 placeholder:text-ink-400 focus-visible:w-56 focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
          />
        </form>
        <div className="flex items-center gap-3 text-sm sm:gap-4">
          {/* 移动端搜索入口（窄屏隐藏搜索框，改为图标跳搜索页） */}
          <Link
            href="/search"
            aria-label="搜索"
            className="text-ink-600 transition-colors hover:text-brand-700 md:hidden"
          >
            <Search className="h-5 w-5" aria-hidden />
          </Link>
          <ThemeToggle />
          {session ? (
            <>
              <Link
                href="/notifications"
                aria-label={unread > 0 ? `通知（${unread} 条未读）` : '通知'}
                className="relative text-ink-600 transition-colors hover:text-brand-700"
              >
                <Bell className="h-5 w-5" aria-hidden />
                {unread > 0 ? (
                  <span className="-right-1.5 -top-1 absolute inline-flex min-w-4 justify-center rounded-full bg-danger-fill px-1 font-medium text-[10px] text-on-fill leading-4">
                    {unread > 99 ? '99+' : unread}
                  </span>
                ) : null}
              </Link>
              <Link
                href={`/u/${session.user.id}`}
                className="font-medium text-ink-800 transition-colors hover:text-brand-700"
              >
                {session.user.name}
              </Link>
              <Link
                href="/bookmarks"
                className="hidden text-ink-600 transition-colors hover:text-brand-700 sm:inline"
              >
                收藏
              </Link>
              <Link
                href="/account"
                className="hidden text-ink-600 transition-colors hover:text-brand-700 sm:inline"
              >
                设置
              </Link>
              <SignOutButton />
            </>
          ) : (
            <>
              <Link href="/login" className="text-ink-600 transition-colors hover:text-brand-700">
                登录
              </Link>
              <Link
                href="/register"
                className="rounded-sm bg-fill px-3 py-1.5 font-medium text-on-fill shadow-paper transition-colors hover:bg-fill-hover"
              >
                注册
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
