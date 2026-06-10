import { SITE_NAME } from '@harublog/config';
import Link from 'next/link';
import { getSession } from '@/lib/session';
import { hasPublishGrant, loadActor } from '@/server/actors';
import { SignOutButton } from './sign-out-button';

export async function SiteHeader() {
  const session = await getSession();
  // admin 入口仅对持发布权角色可见（权限显隐；服务端页面仍有 403 守卫）
  let showReview = false;
  if (session) {
    const actor = await loadActor(session.user.id);
    showReview = actor !== null && hasPublishGrant(actor);
  }

  return (
    <header className="border-b border-ink-200 bg-paper-50">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
        <div className="flex items-baseline gap-8">
          <Link href="/" className="font-serif text-xl font-semibold tracking-wide text-ink-900">
            {SITE_NAME}
          </Link>
          <nav className="flex items-center gap-5 text-sm">
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
            {showReview ? (
              <Link
                href="/admin/review"
                className="text-ink-600 transition-colors hover:text-brand-700"
              >
                审批
              </Link>
            ) : null}
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {session ? (
            <>
              <span className="font-medium text-ink-800">{session.user.name}</span>
              <SignOutButton />
            </>
          ) : (
            <>
              <Link href="/login" className="text-ink-600 transition-colors hover:text-brand-700">
                登录
              </Link>
              <Link
                href="/register"
                className="rounded-sm bg-brand-700 px-3 py-1.5 font-medium text-paper-50 transition-colors hover:bg-brand-800"
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
