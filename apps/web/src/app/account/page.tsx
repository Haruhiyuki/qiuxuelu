import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { AccountForm } from './account-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '账户设置', robots: { index: false } };

export default async function AccountPage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  return (
    <div className="mx-auto w-full max-w-xl px-6 py-10">
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
      />
    </div>
  );
}
