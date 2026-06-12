import {
  documents,
  getDb,
  publishedSnapshots,
  sections,
  subscriptions,
  user as userTable,
} from '@harublog/db';
import { Badge, EmptyState } from '@harublog/ui';
import { and, desc, eq } from 'drizzle-orm';
import { BookOpen } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Breadcrumb } from '@/components/breadcrumb';
import { ButtonLink } from '@/components/button-link';
import { DocumentList } from '@/components/document-list';
import { SubscribeButton } from '@/components/subscribe-button';
import { getSession } from '@/lib/session';
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

  const session = await getSession();
  let subscribed = false;
  if (session) {
    const sub = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(eq(subscriptions.userId, session.user.id), eq(subscriptions.sectionId, section.id)),
      )
      .limit(1);
    subscribed = sub.length > 0;
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pt-8">
      <Breadcrumb items={[{ label: '首页', href: '/' }, { label: section.name }]} />
      <header className="rise-in border-ink-200 border-b pt-2 pb-10">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-semibold font-serif text-3xl text-ink-900 tracking-wide sm:text-4xl">
            {section.name}
          </h1>
          <Badge variant="outline">{stageLabel(section.stage)}</Badge>
          <div className="ml-auto">
            <SubscribeButton
              sectionId={section.id}
              initialSubscribed={subscribed}
              loggedIn={session !== null}
            />
          </div>
        </div>
        {section.description !== null ? (
          <p className="mt-4 max-w-2xl border-accent-200 border-l-2 pl-4 text-base text-ink-600 leading-relaxed">
            {section.description}
          </p>
        ) : null}
      </header>

      <section className="py-10">
        <div className="flex items-baseline gap-3">
          <span aria-hidden className="h-4 w-1 self-center rounded-xs bg-accent-600" />
          <h2 className="font-semibold font-serif text-ink-900 text-xl">已发布文章</h2>
          <p className="text-ink-400 text-sm">共 {docs.length} 篇</p>
        </div>
        {docs.length > 0 ? (
          <div className="mt-4">
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
