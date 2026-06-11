import { documents, getDb, publishedSnapshots, sections, user as userTable } from '@harublog/db';
import { Badge, EmptyState } from '@harublog/ui';
import { desc, eq } from 'drizzle-orm';
import { BookOpen } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Breadcrumb } from '@/components/breadcrumb';
import { ButtonLink } from '@/components/button-link';
import { DocumentList } from '@/components/document-list';
import { stageLabel } from '@/lib/stage';

// M0 一律请求期动态渲染；generateMetadata 同样只在请求期查库
export const dynamic = 'force-dynamic';

interface SectionPageProps {
  params: Promise<{ slug: string }>;
}

async function findSection(slug: string) {
  const db = getDb();
  const rows = await db.select().from(sections).where(eq(sections.slug, slug)).limit(1);
  return rows[0];
}

export async function generateMetadata({ params }: SectionPageProps): Promise<Metadata> {
  const { slug } = await params;
  const section = await findSection(slug);
  if (!section) {
    // notFound() 在 Next 16 会软返回 200（框架限制）；至少标 noindex
    return { title: '板块不存在', robots: { index: false } };
  }
  return {
    title: section.name,
    description: section.description ?? undefined,
  };
}

export default async function SectionPage({ params }: SectionPageProps) {
  const { slug } = await params;
  const section = await findSection(slug);
  if (!section) {
    notFound();
  }

  const db = getDb();
  const docs = await db
    .select({
      id: documents.id,
      title: documents.title,
      slug: documents.slug,
      summary: documents.summary,
      publishedAt: publishedSnapshots.publishedAt,
      authorName: userTable.name,
    })
    .from(documents)
    .innerJoin(publishedSnapshots, eq(publishedSnapshots.documentId, documents.id))
    .leftJoin(userTable, eq(userTable.id, documents.ownerId))
    .where(eq(documents.sectionId, section.id))
    .orderBy(desc(publishedSnapshots.publishedAt))
    .limit(50);

  // innerJoin published_snapshots 已保证「已发布」，再按 status 过滤一道防御性冗余可省；
  // 此处以快照存在为准（发布事务内同步重建，见架构 §3.1）

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pt-6">
      <Breadcrumb items={[{ label: '首页', href: '/' }, { label: section.name }]} />
      <header className="border-b border-ink-200 pb-10">
        <div className="flex items-center gap-3">
          <h1 className="font-serif text-2xl font-semibold text-ink-900 sm:text-3xl">
            {section.name}
          </h1>
          <Badge variant="outline">{stageLabel(section.stage)}</Badge>
        </div>
        {section.description !== null ? (
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink-600">
            {section.description}
          </p>
        ) : null}
      </header>

      <section className="py-10">
        <h2 className="font-serif text-lg font-semibold text-ink-900">已发布文章</h2>
        {docs.length > 0 ? (
          <div className="mt-2">
            <DocumentList items={docs} />
          </div>
        ) : (
          <EmptyState
            icon={<BookOpen />}
            title="本板块还没有文章"
            description="这一段路还没人写下来。注册后即可起草第一篇。"
            action={<ButtonLink href="/register">开始写作</ButtonLink>}
          />
        )}
      </section>
    </div>
  );
}
