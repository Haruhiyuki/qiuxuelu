// 编辑建议提交页（ADR-0010）：can('feedback.create')（公共 T1 / 私有 T2）。
import { documents, getDb } from '@harublog/db';
import { can } from '@harublog/domain';
import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { FeedbackForm } from '@/components/feedback-form';
import { getSession } from '@/lib/session';
import { loadActor } from '@/server/actors';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '提编辑建议', robots: { index: false } };

function Blocked({ slug, text }: { slug: string; text: string }) {
  return (
    <div className="mx-auto w-full max-w-xl px-6 py-20 text-center">
      <h1 className="font-serif text-2xl text-ink-900">暂不可提交编辑建议</h1>
      <p className="mt-3 text-ink-500 text-sm">{text}</p>
      <p className="mt-6 text-sm">
        <Link href={`/a/${slug}`} className="text-brand-700 hover:text-brand-900">
          ← 返回文章
        </Link>
      </p>
    </div>
  );
}

export default async function FeedbackPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  const rows = await getDb()
    .select({
      id: documents.id,
      slug: documents.slug,
      title: documents.title,
      ownerId: documents.ownerId,
      sectionId: documents.sectionId,
      status: documents.status,
      visibility: documents.visibility,
    })
    .from(documents)
    .where(eq(documents.slug, slug))
    .limit(1);
  const doc = rows[0];
  if (doc?.status !== 'published') {
    notFound();
  }
  const actor = await loadActor(session.user.id);
  if (actor === null) {
    return <Blocked slug={slug} text="账号状态异常，请重新登录。" />;
  }
  const decision = can(actor, 'feedback.create', {
    sectionId: doc.sectionId,
    doc: {
      id: doc.id,
      ownerId: doc.ownerId ?? '',
      editPolicy: 'suggest_only',
      status: 'published',
      visibility: doc.visibility as 'private' | 'public',
    },
  });
  if (!decision.allow) {
    const need = doc.visibility === 'public' ? 'T1（成员）' : 'T2（贡献者，私有页要求更高）';
    return <Blocked slug={slug} text={`提交编辑建议需要 ${need}。多参与社区贡献即可达标。`} />;
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <div className="mb-5 flex items-baseline gap-3 border-ink-200 border-b pb-4">
        <span aria-hidden className="h-5 w-1 self-center rounded-xs bg-accent-600" />
        <h1 className="font-semibold font-serif text-2xl text-ink-900">编辑建议</h1>
        <Link href={`/a/${slug}`} className="text-ink-400 text-sm hover:text-brand-700">
          ← {doc.title}
        </Link>
      </div>
      <FeedbackForm docId={doc.id} slug={doc.slug} title={doc.title} />
    </div>
  );
}
