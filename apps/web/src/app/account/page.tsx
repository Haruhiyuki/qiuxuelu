import { getDb, userNameHistory, user as userTable } from '@harublog/db';
import { and, count, eq, gte } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Breadcrumb } from '@/components/breadcrumb';
import { getSession } from '@/lib/session';
import { AccountForm } from './account-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '账户设置', robots: { index: false } };

// 设置分区导航（锚点）：与 AccountForm 内的 SettingsGroup id 一一对应
const NAV = [
  ['profile', '个人资料'],
  ['security', '账户与安全'],
  ['notifications', '通知'],
  ['data', '数据与账号'],
] as const;

export default async function AccountPage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  const db = getDb();
  const prefRow = (
    await db
      .select({
        emailNotifications: userTable.emailNotifications,
        bio: userTable.bio,
        educationStage: userTable.educationStage,
        image: userTable.image,
        twoFactorEnabled: userTable.twoFactorEnabled,
      })
      .from(userTable)
      .where(eq(userTable.id, session.user.id))
      .limit(1)
  )[0];

  // 改名配额：7 天滚动窗口内最多 2 次（与 renameUser 同口径）
  const RENAME_WINDOW_DAYS = 7;
  const RENAME_LIMIT = 2;
  const windowStart = new Date(Date.now() - RENAME_WINDOW_DAYS * 86_400_000);
  const renameRows = await db
    .select({ n: count() })
    .from(userNameHistory)
    .where(
      and(eq(userNameHistory.userId, session.user.id), gte(userNameHistory.changedAt, windowStart)),
    );
  const renameQuota = {
    remaining: Math.max(0, RENAME_LIMIT - Number(renameRows[0]?.n ?? 0)),
    limit: RENAME_LIMIT,
    windowDays: RENAME_WINDOW_DAYS,
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <Breadcrumb items={[{ label: '首页', href: '/' }, { label: '账户设置' }]} />
      <header className="border-ink-200 border-b pb-6">
        <h1 className="font-semibold font-serif text-2xl text-ink-900">账户设置</h1>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-ink-500 text-sm">
          <span>管理你的资料、账户安全与通知偏好。</span>
          <Link href={`/u/${session.user.id}`} className="text-brand-700 hover:text-brand-900">
            查看我的主页 →
          </Link>
          <Link href="/account/feedback" className="text-brand-700 hover:text-brand-900">
            我的编辑建议 →
          </Link>
          <Link href="/write" className="text-brand-700 hover:text-brand-900">
            草稿箱 / 修订申请 →
          </Link>
        </p>
      </header>

      <div className="mt-8 grid gap-10 md:grid-cols-[180px_minmax(0,1fr)]">
        {/* 分区导航：桌面端吸顶侧栏，移动端隐藏（直接向下滚动卡片） */}
        <nav aria-label="设置分区" className="hidden md:block">
          <ul className="sticky top-20 flex flex-col gap-0.5 text-sm">
            {NAV.map(([id, label]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="block rounded-sm px-3 py-1.5 text-ink-600 transition-colors hover:bg-paper-200 hover:text-ink-900"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <AccountForm
          initialName={session.user.name}
          email={session.user.email}
          emailVerified={session.user.emailVerified}
          emailNotifications={prefRow?.emailNotifications ?? true}
          initialBio={prefRow?.bio ?? ''}
          initialEducationStage={prefRow?.educationStage ?? ''}
          initialImage={prefRow?.image ?? ''}
          renameQuota={renameQuota}
          twoFactorEnabled={prefRow?.twoFactorEnabled ?? false}
        />
      </div>
    </div>
  );
}
