// 我的收藏：当前用户收藏的已发布文章。
import {
  docReactions,
  documents,
  getDb,
  publishedSnapshots,
  sections,
  user as userTable,
} from '@harublog/db';
import { EmptyState } from '@harublog/ui';
import { and, desc, eq } from 'drizzle-orm';
import { Bookmark } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Breadcrumb } from '@/components/breadcrumb';
import { DocumentList } from '@/components/document-list';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '我的收藏', robots: { index: false } };

export default async function BookmarksPage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  const db = getDb();
  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      slug: documents.slug,
      summary: documents.summary,
      publishedAt: publishedSnapshots.publishedAt,
      authorName: userTable.name,
      sectionName: sections.name,
      sectionSlug: sections.slug,
    })
    .from(docReactions)
    .innerJoin(documents, eq(documents.id, docReactions.documentId))
    .innerJoin(publishedSnapshots, eq(publishedSnapshots.documentId, documents.id))
    .innerJoin(sections, eq(sections.id, documents.sectionId))
    .leftJoin(userTable, eq(userTable.id, documents.ownerId))
    .where(
      and(
        eq(docReactions.userId, session.user.id),
        eq(docReactions.kind, 'bookmark'),
        eq(documents.status, 'published'),
      ),
    )
    .orderBy(desc(docReactions.createdAt));

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <Breadcrumb items={[{ label: '首页', href: '/' }, { label: '我的收藏' }]} />
      <header className="border-ink-200 border-b pb-6">
        <h1 className="font-semibold font-serif text-2xl text-ink-900">我的收藏</h1>
      </header>
      {rows.length > 0 ? (
        <div className="mt-4">
          <DocumentList items={rows.map((d) => ({ ...d, authorName: d.authorName ?? null }))} />
        </div>
      ) : (
        <EmptyState
          icon={<Bookmark />}
          title="还没有收藏"
          description="在文章页点「收藏」，之后可在这里快速找回。"
        />
      )}
    </div>
  );
}
