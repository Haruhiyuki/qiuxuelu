import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { hasConsented } from '@/server/consent';
import { ConsentForm } from './consent-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '完成注册同意', robots: { index: false } };

export default async function ConsentPage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  if (await hasConsented(session.user.id)) {
    redirect('/');
  }
  return (
    <div className="mx-auto w-full max-w-xl px-6 py-12">
      <h1 className="font-semibold font-serif text-2xl text-ink-900">最后一步：内容授权与公约</h1>
      <p className="mt-3 text-ink-600 text-sm leading-relaxed">
        求学路是协作平台——你的内容会被他人修订与再发布，因此需要你明确授权。这一步确认后即可开始贡献。
      </p>
      <ConsentForm />
    </div>
  );
}
