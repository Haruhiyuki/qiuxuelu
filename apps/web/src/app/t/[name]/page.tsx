// 标签页：列出带某标签的已发布文章。
import {
  documents,
  documentTags,
  getDb,
  publishedSnapshots,
  sections,
  tags as tagsTable,
  user as userTable,
} from '@harublog/db';
import { EmptyState } from '@harublog/ui';
import { and, desc, eq } from 'drizzle-orm';
import { Tag } from 'lucide-react';
import type { Metadata } from 'next';
import { Breadcrumb } from '@/components/breadcrumb';
import { DocumentList } from '@/components/document-list';

export const dynamic = 'force-dynamic';

interface TagPageProps {
  params: Promise<{ name: string }>;
}

export async function generateMetadata({ params }: TagPageProps): Promise<Metadata> {
  const { name } = await params;
  const tag = decodeURIComponent(name);
  return { title: `标签：${tag}`, description: `带「${tag}」标签的求学经验文章。` };
}

export default async function TagPage({ params }: TagPageProps) {
  const { name } = await params;
  const tag = decodeURIComponent(name);
  const db = getDb();
  const docs = await db
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
    .from(documentTags)
    .innerJoin(tagsTable, eq(tagsTable.id, documentTags.tagId))
    .innerJoin(documents, eq(documents.id, documentTags.documentId))
    .innerJoin(publishedSnapshots, eq(publishedSnapshots.documentId, documents.id))
    .innerJoin(sections, eq(sections.id, documents.sectionId))
    .leftJoin(userTable, eq(userTable.id, documents.ownerId))
    .where(and(eq(tagsTable.name, tag), eq(documents.status, 'published')))
    .orderBy(desc(publishedSnapshots.publishedAt))
    .limit(50);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <Breadcrumb items={[{ label: '首页', href: '/' }, { label: `#${tag}` }]} />
      <header className="border-ink-200 border-b pb-6">
        <h1 className="font-semibold font-serif text-2xl text-ink-900">#{tag}</h1>
        <p className="mt-2 text-ink-500 text-sm">带此标签的已发布文章</p>
      </header>
      {docs.length > 0 ? (
        <div className="mt-4">
          <DocumentList items={docs.map((d) => ({ ...d, authorName: d.authorName ?? null }))} />
        </div>
      ) : (
        <EmptyState
          icon={<Tag />}
          title="还没有文章用此标签"
          description="换个标签或去首页浏览。"
        />
      )}
    </div>
  );
}
