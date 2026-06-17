import { documents, getDb, publishedSnapshots } from '@harublog/db';
import { can } from '@harublog/domain';
import { type DocJson, validateDoc } from '@harublog/kernel';
import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { CollabEditor } from '@/components/editor/collab-editor';
import { getSession } from '@/lib/session';
import { loadActor } from '@/server/actors';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '修订申请', robots: { index: false } };

interface SuggestPageProps {
  params: Promise<{ slug: string }>;
}

function Blocked({ slug, text }: { slug: string; text: string }) {
  return (
    <div className="mx-auto w-full max-w-xl px-6 py-20 text-center">
      <h1 className="font-serif text-2xl text-ink-900">暂不可提交修订申请</h1>
      <p className="mt-3 text-ink-500 text-sm">{text}</p>
      <p className="mt-6 text-sm">
        <Link href={`/a/${slug}`} className="text-brand-700 hover:text-brand-900">
          ← 返回博客
        </Link>
      </p>
    </div>
  );
}

export default async function SuggestPage({ params }: SuggestPageProps) {
  const { slug } = await params;
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const db = getDb();
  const rows = await db
    .select({
      id: documents.id,
      slug: documents.slug,
      title: documents.title,
      ownerId: documents.ownerId,
      sectionId: documents.sectionId,
      status: documents.status,
      visibility: documents.visibility,
      editPolicy: documents.editPolicy,
      content: publishedSnapshots.content,
    })
    .from(documents)
    .innerJoin(publishedSnapshots, eq(publishedSnapshots.documentId, documents.id))
    .where(eq(documents.slug, slug))
    .limit(1);
  const doc = rows[0];
  if (doc?.status !== 'published') {
    notFound();
  }
  if (doc.ownerId === session.user.id) {
    return <Blocked slug={slug} text="作者请直接修订自己的博客，无需申请。" />;
  }

  const actor = await loadActor(session.user.id);
  if (actor === null) {
    return <Blocked slug={slug} text="账号状态异常，请重新登录。" />;
  }
  const decision = can(actor, 'suggestion.create', {
    sectionId: doc.sectionId,
    doc: {
      id: doc.id,
      ownerId: doc.ownerId ?? '',
      editPolicy: doc.editPolicy as 'open' | 'locked',
      status: 'published',
      visibility: doc.visibility as 'private' | 'public',
    },
  });
  if (!decision.allow) {
    const need = doc.visibility === 'public' ? 'T2（贡献者）' : 'T3（资深贡献者，私有页要求更高）';
    return (
      <Blocked
        slug={slug}
        text={`提交修订申请需要 ${need}。多参与社区贡献，信任等级达标后即可解锁。`}
      />
    );
  }

  let initialDoc: DocJson;
  try {
    initialDoc = validateDoc(doc.content);
  } catch {
    return <Blocked slug={slug} text="博客内容暂时无法载入编辑器。" />;
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <CollabEditor
        docId={doc.id}
        slug={doc.slug}
        title={doc.title}
        initialDoc={initialDoc}
        mode="suggest"
      />
    </div>
  );
}
