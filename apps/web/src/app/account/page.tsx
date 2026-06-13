import { getDb, userNameHistory, user as userTable } from '@harublog/db';
import { and, count, eq, gte } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Breadcrumb } from '@/components/breadcrumb';
import { getSession } from '@/lib/session';
import { AccountForm } from './account-form';
import { PasskeySection } from './passkey-section';
import { TwoFactorSection } from './two-factor-section';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '账户设置', robots: { index: false } };

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
    <div className="mx-auto w-full max-w-xl px-6 py-10">
      <Breadcrumb items={[{ label: '首页', href: '/' }, { label: '账户设置' }]} />
      <header className="border-ink-200 border-b pb-6">
        <h1 className="font-semibold font-serif text-2xl text-ink-900">账户设置</h1>
        <p className="mt-2 flex flex-wrap gap-x-4 text-ink-500 text-sm">
          <span>管理你的昵称与密码。</span>
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
      <AccountForm
        initialName={session.user.name}
        email={session.user.email}
        emailVerified={session.user.emailVerified}
        emailNotifications={prefRow?.emailNotifications ?? true}
        initialBio={prefRow?.bio ?? ''}
        initialEducationStage={prefRow?.educationStage ?? ''}
        initialImage={prefRow?.image ?? ''}
        renameQuota={renameQuota}
      />
      <div className="mt-8">
        <TwoFactorSection enabled={prefRow?.twoFactorEnabled ?? false} />
      </div>
      <div className="mt-8">
        <PasskeySection />
      </div>
    </div>
  );
}
