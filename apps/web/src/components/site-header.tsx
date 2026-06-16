import { SITE_NAME } from '@harublog/config';
import { getDb } from '@harublog/db';
import { PenLine } from 'lucide-react';
import Link from 'next/link';
import { getSession } from '@/lib/session';
import { hasPublishGrant, loadActor } from '@/server/actors';
import { hasConsented } from '@/server/consent';
import { countUnread } from '@/server/notifications';
import { LogoMark } from './logo-mark';
import { MobileNav } from './mobile-nav';
import { NavLink } from './nav-link';
import { SearchTrigger } from './search/search-trigger';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

export async function SiteHeader() {
  const session = await getSession();
  // 管理入口仅对持有任一治理角色者可见（权限显隐；各后台页仍有服务端守卫）
  let showAdmin = false;
  let unread = 0;
  let needConsent = false;
  if (session) {
    // 三项互不依赖，并行取（actor 经 cache() 去重，页面后续再取不重复查库）
    const [actor, unreadCount, consented] = await Promise.all([
      loadActor(session.user.id),
      countUnread(getDb(), session.user.id),
      hasConsented(session.user.id),
    ]);
    showAdmin = actor !== null && (hasPublishGrant(actor) || actor.roles.length > 0);
    unread = unreadCount;
    needConsent = !consented;
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
            后即可发布、评论与提交修订申请。
          </div>
        </div>
      ) : null}
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-4 sm:gap-8">
          <Link href="/" className="group flex shrink-0 items-center gap-2.5">
            {/* 站标：朱砂方印 + 上行之路（详见 LogoMark） */}
            <LogoMark className="h-7 w-7 shrink-0 rounded-xs shadow-paper transition-transform group-hover:-rotate-3" />
            <span className="whitespace-nowrap font-semibold font-serif text-ink-900 text-xl tracking-wide">
              {SITE_NAME}
            </span>
          </Link>
          {/* 桌面主导航（窄屏收进汉堡菜单） */}
          <nav className="hidden items-center gap-3 text-sm md:flex md:gap-4 lg:gap-6">
            <NavLink href="/news" match="/news">
              近闻
            </NavLink>
            {showAdmin ? (
              <NavLink href="/admin" match="/admin">
                管理
              </NavLink>
            ) : null}
          </nav>
        </div>
        <SearchTrigger />
        {/* 桌面账户簇（md+）：从左到右按「内容 → 操作 → 工具 → 身份」分组——
            创作中心(枢纽) · 写文章(主操作) · 主题(工具) · 头像菜单(身份，含设置/通知/收藏/退出) */}
        <div className="hidden items-center gap-3 text-sm md:flex md:gap-4">
          {session ? (
            <Link href="/write" className="text-ink-600 transition-colors hover:text-brand-700">
              创作中心
            </Link>
          ) : null}
          {/* 写文章：直达写作页（未登录跳登录，拒绝变引导） */}
          <Link
            href={session ? '/write/new' : '/login'}
            className="inline-flex items-center gap-1.5 rounded-sm bg-fill px-3 py-1.5 font-medium text-on-fill shadow-paper transition-colors hover:bg-fill-hover"
          >
            <PenLine className="h-4 w-4" aria-hidden />
            写文章
          </Link>
          <ThemeToggle />
          {session ? (
            <UserMenu
              userId={session.user.id}
              userName={session.user.name}
              userImage={session.user.image ?? null}
              unread={unread}
            />
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
        {/* 移动端：低调的「写文章」直出在栏上 + 汉堡菜单（其余收进抽屉） */}
        <div className="flex items-center gap-1 md:hidden">
          <Link
            href={session ? '/write/new' : '/login'}
            aria-label="写文章"
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-ink-600 text-sm transition-colors hover:bg-paper-200 hover:text-brand-700"
          >
            <PenLine className="h-4 w-4" aria-hidden />
            写文章
          </Link>
          <MobileNav
            loggedIn={session !== null}
            userName={session?.user.name ?? null}
            userId={session?.user.id ?? null}
            unread={unread}
            showAdmin={showAdmin}
          />
        </div>
      </div>
    </header>
  );
}
