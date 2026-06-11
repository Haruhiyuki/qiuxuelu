import { documents, getDb } from '@harublog/db';
import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { RealtimeEditor } from '@/components/editor/realtime-editor';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '实时协作编辑', robots: { index: false } };

interface CollabPageProps {
  params: Promise<{ docId: string }>;
}

export default async function RealtimeCollabPage({ params }: CollabPageProps) {
  const { docId } = await params;
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  if (!z.uuid().safeParse(docId).success) {
    notFound();
  }

  const db = getDb();
  const rows = await db
    .select({ id: documents.id, slug: documents.slug, title: documents.title })
    .from(documents)
    .where(eq(documents.id, docId))
    .limit(1);
  const doc = rows[0];
  if (!doc) {
    notFound();
  }

  // 实时协作授权（owner/editor+/TL4）在 issueCollabToken 中强制；此处仅渲染会话外壳
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <RealtimeEditor
        docId={doc.id}
        slug={doc.slug}
        title={doc.title}
        userName={session.user.name}
      />
    </div>
  );
}
