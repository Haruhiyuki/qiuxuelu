import { SITE_DESCRIPTION } from '@harublog/config';
import { documents, getDb, publishedSnapshots, sections, user as userTable } from '@harublog/db';
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@harublog/ui';
import { asc, desc, eq, isNull } from 'drizzle-orm';
import { PenLine } from 'lucide-react';
import Link from 'next/link';
import { ButtonLink } from '@/components/button-link';
import { DocumentList } from '@/components/document-list';
import { stageLabel } from '@/lib/stage';

// M0 一律请求期动态渲染（ISR 是 M1 的事）；构建期不触碰数据库
export const dynamic = 'force-dynamic';

async function fetchLatestPublished() {
  const db = getDb();
  return db
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
    .from(documents)
    .innerJoin(publishedSnapshots, eq(publishedSnapshots.documentId, documents.id))
    .innerJoin(sections, eq(sections.id, documents.sectionId))
    .leftJoin(userTable, eq(userTable.id, documents.ownerId))
    .where(eq(documents.status, 'published'))
    .orderBy(desc(publishedSnapshots.publishedAt))
    .limit(10);
}

async function fetchTopSections() {
  const db = getDb();
  return db
    .select()
    .from(sections)
    .where(isNull(sections.parentId))
    .orderBy(asc(sections.position));
}

export default async function HomePage() {
  const [latest, topSections] = await Promise.all([fetchLatestPublished(), fetchTopSections()]);

  return (
    <div className="mx-auto w-full max-w-5xl px-6">
      {/* Hero：站点使命 + 主次 CTA */}
      <section className="border-b border-ink-200 py-16 text-center sm:py-20">
        <h1 className="mx-auto max-w-2xl font-serif text-3xl font-semibold leading-snug text-ink-900 sm:text-4xl">
          把走过的路，写成后来者的地图
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-ink-600">
          {SITE_DESCRIPTION}
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <ButtonLink href="/register">开始写作</ButtonLink>
          <ButtonLink href="/#sections" variant="secondary">
            浏览板块
          </ButtonLink>
        </div>
      </section>

      {/* 最新发布 */}
      <section className="py-12">
        <h2 className="font-serif text-xl font-semibold text-ink-900">最新发布</h2>
        {latest.length > 0 ? (
          <div className="mt-2">
            <DocumentList
              items={latest.map((row) => ({
                ...row,
                authorName: row.authorName ?? null,
              }))}
            />
          </div>
        ) : (
          <EmptyState
            icon={<PenLine />}
            title="还没有发布的文章"
            description="第一篇求学经验，由你来写——注册后即可起草，发布前会有志愿者协助审校。"
            action={<ButtonLink href="/register">开始写作</ButtonLink>}
          />
        )}
      </section>

      {/* 板块入口 */}
      <section id="sections" className="border-t border-ink-200 py-12">
        <h2 className="font-serif text-xl font-semibold text-ink-900">板块</h2>
        <div className="mt-6 grid grid-cols-1 gap-4 pb-4 sm:grid-cols-2 lg:grid-cols-4">
          {topSections.map((section) => (
            <Link key={section.id} href={`/s/${section.slug}`} className="group block">
              <Card className="h-full transition-colors group-hover:border-brand-300">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>{section.name}</CardTitle>
                    <Badge variant="outline">{stageLabel(section.stage)}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed text-ink-500">{section.description}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
        {topSections.length === 0 ? (
          <EmptyState
            title="板块尚未初始化"
            description="请管理员执行数据库种子脚本（pnpm db:seed）创建初始板块。"
          />
        ) : null}
      </section>
    </div>
  );
}
