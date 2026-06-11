import { getDb, user as userTable } from '@harublog/db';
import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Breadcrumb } from '@/components/breadcrumb';
import { getSession } from '@/lib/session';
import { AccountForm } from './account-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '账户设置', robots: { index: false } };

export default async function AccountPage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  const prefRow = (
    await getDb()
      .select({ emailNotifications: userTable.emailNotifications })
      .from(userTable)
      .where(eq(userTable.id, session.user.id))
      .limit(1)
  )[0];
  return (
    <div className="mx-auto w-full max-w-xl px-6 py-10">
      <Breadcrumb items={[{ label: '首页', href: '/' }, { label: '账户设置' }]} />
      <header className="border-ink-200 border-b pb-6">
        <h1 className="font-semibold font-serif text-2xl text-ink-900">账户设置</h1>
        <p className="mt-2 text-ink-500 text-sm">
          管理你的昵称与密码。
          <Link href={`/u/${session.user.id}`} className="ml-2 text-brand-700 hover:text-brand-900">
            查看我的主页 →
          </Link>
        </p>
      </header>
      <AccountForm
        initialName={session.user.name}
        email={session.user.email}
        emailVerified={session.user.emailVerified}
        emailNotifications={prefRow?.emailNotifications ?? true}
      />
    </div>
  );
}
