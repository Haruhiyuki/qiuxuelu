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
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Breadcrumb } from '@/components/breadcrumb';
import { ButtonLink } from '@/components/button-link';
import { DocumentList } from '@/components/document-list';
import { SubscribeButton } from '@/components/subscribe-button';
import { getSession } from '@/lib/session';
import { stageLabel } from '@/lib/stage';
import { countSectionPublished, getSectionTags, sectionDocFilter } from '@/server/section-tags';

// M0 一律请求期动态渲染；generateMetadata 同样只在请求期查库
export const dynamic = 'force-dynamic';

interface SectionPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tag?: string }>;
}

async function findSection(slug: string) {
  const db = getDb();
  const rows = await db.select().from(sections).where(eq(sections.slug, slug)).limit(1);
  return rows[0];
}

export async function generateMetadata({
  params,
  searchParams,
}: SectionPageProps): Promise<Metadata> {
  const { slug } = await params;
  const { tag } = await searchParams;
  const section = await findSection(slug);
  if (!section) {
    // notFound() 在 Next 16 会软返回 200（框架限制）；至少标 noindex
    return { title: '板块不存在', robots: { index: false } };
  }
  const activeTag = typeof tag === 'string' && tag.length > 0 ? tag : null;
  return {
    title: activeTag !== null ? `${section.name} · #${activeTag}` : section.name,
    description: section.description ?? undefined,
    // 标签筛选视图 noindex（防同内容多 URL 重复收录）
    ...(activeTag !== null ? { robots: { index: false } } : {}),
  };
}

export default async function SectionPage({ params, searchParams }: SectionPageProps) {
  const { slug } = await params;
  const { tag } = await searchParams;
  const section = await findSection(slug);
  if (!section) {
    notFound();
  }
  const activeTag = typeof tag === 'string' && tag.length > 0 ? tag : null;
  const sectionPath = `/s/${section.slug}`;

  const db = getDb();
  const [docs, sectionTags, total, session] = await Promise.all([
    db
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
      .where(sectionDocFilter(section.id, activeTag))
      .orderBy(desc(publishedSnapshots.publishedAt))
      .limit(50),
    getSectionTags(db, section.id),
    countSectionPublished(db, section.id),
    getSession(),
  ]);

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

  const hasTags = sectionTags.length > 0;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pt-8">
      <Breadcrumb
        items={[
          { label: '首页', href: '/' },
          activeTag !== null ? { label: section.name, href: sectionPath } : { label: section.name },
          ...(activeTag !== null ? [{ label: `#${activeTag}` }] : []),
        ]}
      />
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

      <div className="grid grid-cols-1 gap-x-10 py-10 lg:grid-cols-[180px_minmax(0,1fr)]">
        {/* 左栏：标签分类导航（板块内聚合）。无标签则不渲染整栏。 */}
        {hasTags ? (
          <aside className="mb-8 lg:mb-0">
            <nav aria-label="标签分类" className="lg:sticky lg:top-24">
              <p className="flex items-center gap-2 font-medium text-ink-400 text-xs tracking-[0.2em]">
                <span aria-hidden className="h-3 w-0.5 rounded-xs bg-accent-600" />
                分类
              </p>
              <ul className="mt-3 flex flex-wrap gap-1.5 lg:flex-col lg:gap-0.5">
                <li>
                  <CategoryItem
                    href={sectionPath}
                    label="全部"
                    count={total}
                    active={activeTag === null}
                  />
                </li>
                {sectionTags.map((t) => (
                  <li key={t.name}>
                    <CategoryItem
                      href={`${sectionPath}?tag=${encodeURIComponent(t.name)}`}
                      label={`#${t.name}`}
                      count={t.count}
                      active={activeTag === t.name}
                    />
                  </li>
                ))}
              </ul>
            </nav>
          </aside>
        ) : null}

        <section className={hasTags ? '' : 'lg:col-span-full'}>
          <div className="flex flex-wrap items-baseline gap-3">
            <span aria-hidden className="h-4 w-1 self-center rounded-xs bg-accent-600" />
            <h2 className="font-semibold font-serif text-ink-900 text-xl">
              {activeTag !== null ? `#${activeTag}` : '已发布文章'}
            </h2>
            <p className="text-ink-400 text-sm">{docs.length} 篇</p>
            {activeTag !== null ? (
              <Link
                href={sectionPath}
                className="text-brand-700 text-sm transition-colors hover:text-brand-900"
              >
                清除筛选
              </Link>
            ) : null}
          </div>
          {docs.length > 0 ? (
            <div className="mt-4">
              <DocumentList items={docs} />
            </div>
          ) : activeTag !== null ? (
            <p className="mt-6 text-ink-400 text-sm">
              本板块暂无带「#{activeTag}」标签的文章。
              <Link href={sectionPath} className="ml-2 text-brand-700 hover:text-brand-900">
                查看全部 →
              </Link>
            </p>
          ) : (
            <EmptyState
              icon={<BookOpen />}
              title="本板块还没有文章"
              description="这一段路还没人写下来。注册后即可起草第一篇。"
              action={<ButtonLink href={session ? '/write/new' : '/register'}>开始写作</ButtonLink>}
            />
          )}
        </section>
      </div>
    </div>
  );
}

/** 分类列表项：横排（窄屏）= 胶囊，竖排（宽屏）= 行，命中态高亮。 */
function CategoryItem({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
        active
          ? 'bg-brand-50 font-medium text-brand-800'
          : 'text-ink-600 hover:bg-paper-200 hover:text-ink-900'
      }`}
    >
      <span className="truncate">{label}</span>
      <span
        className={`shrink-0 tabular-nums text-xs ${active ? 'text-brand-700' : 'text-ink-400'}`}
      >
        {count}
      </span>
    </Link>
  );
}
