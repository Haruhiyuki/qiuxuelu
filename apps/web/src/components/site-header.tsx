import { SITE_NAME } from '@harublog/config';
import { getDb } from '@harublog/db';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { getSession } from '@/lib/session';
import { hasPublishGrant, loadActor } from '@/server/actors';
import { hasConsented } from '@/server/consent';
import { countUnread } from '@/server/notifications';
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
    <header className="border-b border-ink-200 bg-paper-50">
      {needConsent ? (
        <div className="bg-ochre-50 text-center text-ochre-900 text-sm">
          <div className="mx-auto max-w-5xl px-4 py-2">
            还差一步：
            <Link href="/onboarding/consent" className="font-medium underline underline-offset-2">
              确认内容授权与社区公约
            </Link>
            后即可发布、评论与提交建议。
          </div>
        </div>
      ) : null}
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex items-baseline gap-4 sm:gap-8">
          <Link
            href="/"
            className="shrink-0 whitespace-nowrap font-serif text-xl font-semibold tracking-wide text-ink-900"
          >
            {SITE_NAME}
          </Link>
          <nav className="flex items-center gap-3 text-sm sm:gap-5">
            <Link href="/#sections" className="text-ink-600 transition-colors hover:text-brand-700">
              板块
            </Link>
            {/* 未登录也显示入口，点击跳登录（拒绝变引导） */}
            <Link
              href={session ? '/write' : '/login'}
              className="text-ink-600 transition-colors hover:text-brand-700"
            >
              写文章
            </Link>
            {showAdmin ? (
              <Link href="/admin" className="text-ink-600 transition-colors hover:text-brand-700">
                管理
              </Link>
            ) : null}
          </nav>
        </div>
        <form method="get" action="/search" className="hidden sm:block">
          <input
            type="search"
            name="q"
            placeholder="搜索…"
            aria-label="搜索"
            className="h-8 w-40 rounded-sm border border-ink-200 bg-paper-100 px-3 text-sm text-ink-800 placeholder:text-ink-400 focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
          />
        </form>
        <div className="flex items-center gap-4 text-sm">
          {/* 移动端搜索入口（窄屏隐藏搜索框，改为图标跳搜索页） */}
          <Link
            href="/search"
            aria-label="搜索"
            className="text-ink-600 transition-colors hover:text-brand-700 sm:hidden"
          >
            <Search className="h-5 w-5" aria-hidden />
          </Link>
          <ThemeToggle />
          {session ? (
            <>
              <Link
                href="/notifications"
                className="relative text-ink-600 transition-colors hover:text-brand-700"
              >
                通知
                {unread > 0 ? (
                  <span className="ml-1 inline-flex min-w-[1.25rem] justify-center rounded-full bg-danger-fill px-1.5 py-0.5 text-xs font-medium text-on-fill">
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
              <Link href="/account" className="text-ink-600 transition-colors hover:text-brand-700">
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
                className="rounded-sm bg-fill px-3 py-1.5 font-medium text-on-fill transition-colors hover:bg-fill-hover"
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
