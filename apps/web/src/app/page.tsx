import { SITE_DESCRIPTION, SITE_NAME } from '@harublog/config';
import { documents, getDb, publishedSnapshots, sections, user as userTable } from '@harublog/db';
import { Badge, EmptyState } from '@harublog/ui';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { ArrowRight, PenLine } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ButtonLink } from '@/components/button-link';
import { DocumentList } from '@/components/document-list';
import { formatDate } from '@/lib/format';
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

async function fetchFeatured() {
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
    .where(and(eq(documents.status, 'published'), eq(documents.featured, true)))
    .orderBy(desc(publishedSnapshots.publishedAt))
    .limit(6);
}

async function fetchTopSections() {
  const db = getDb();
  return db
    .select()
    .from(sections)
    .where(isNull(sections.parentId))
    .orderBy(asc(sections.position));
}

/** 章节标题：朱砂短竖标 + 衬线题字 + 可选注语，全页统一章法 */
function SectionHeading({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span aria-hidden className="h-4.5 w-1 self-center rounded-xs bg-accent-600" />
      <h2 className="font-semibold font-serif text-2xl text-ink-900">{title}</h2>
      {sub !== undefined ? <p className="text-ink-400 text-sm">{sub}</p> : null}
    </div>
  );
}

/** 中文序号：精选卡片的底纹大字 */
const CJK_ORDINALS = ['壹', '贰', '叁', '肆', '伍', '陆'] as const;

export default async function HomePage() {
  const [latest, featured, topSections] = await Promise.all([
    fetchLatestPublished(),
    fetchFeatured(),
    fetchTopSections(),
  ]);

  return (
    <div className="mx-auto w-full max-w-6xl px-6">
      {/* Hero：左题右注的非对称版式。右侧为稿纸界栏 + 竖排注语（纯装饰，窄屏隐藏） */}
      <section className="relative grid items-center gap-8 border-ink-200 border-b py-16 sm:py-24 md:grid-cols-[minmax(0,1fr)_200px]">
        <div className="rise-in">
          <p className="flex items-center gap-3 text-ink-500 text-sm tracking-[0.35em]">
            <span aria-hidden className="h-px w-10 bg-accent-600" />
            共笔 · 互校 · 开放
          </p>
          <h1 className="mt-6 max-w-2xl font-semibold font-serif text-4xl text-ink-900 leading-snug tracking-wide sm:text-5xl sm:leading-snug">
            把走过的路，
            <br />
            写成后来者的地图
          </h1>
          <p className="mt-6 max-w-xl text-base text-ink-600 leading-relaxed">{SITE_DESCRIPTION}</p>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <ButtonLink href="/register" className="h-10 px-6">
              开始写作
            </ButtonLink>
            <ButtonLink href="/#sections" variant="secondary" className="h-10 px-6">
              浏览板块
            </ButtonLink>
          </div>
        </div>
        {/* 稿纸界栏：竖排注语 + 朱印，致敬线装书的行格 */}
        <div aria-hidden className="rise-in-late hidden h-72 select-none justify-self-end md:flex">
          <div className="flex gap-5 border-ink-200 border-r border-l px-5">
            <p className="font-serif text-ink-300 text-sm tracking-[0.5em] [writing-mode:vertical-rl]">
              凡走过的路皆可成书
            </p>
            <div className="flex flex-col items-center gap-4">
              <p className="font-serif text-ink-700 text-lg tracking-[0.35em] [writing-mode:vertical-rl]">
                {SITE_NAME} · 集体编纂
              </p>
              <span className="flex h-8 w-8 items-center justify-center rounded-xs bg-danger-fill font-serif text-base text-on-fill">
                {SITE_NAME.charAt(0)}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 精选：编辑部择优，带中文序号底纹的卡片 */}
      {featured.length > 0 ? (
        <section className="border-ink-200 border-b py-14">
          <SectionHeading title="精选" sub="经社区审校的代表作" />
          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((item, i) => (
              <Link key={item.id} href={`/a/${item.slug}`} className="group block">
                <article className="relative h-full overflow-hidden rounded-md border border-ink-200 bg-paper-50 p-5 shadow-paper transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-brand-300 group-hover:shadow-lift">
                  <span
                    aria-hidden
                    className="-top-3 pointer-events-none absolute right-2 select-none font-serif text-7xl text-ink-900 opacity-[0.06]"
                  >
                    {CJK_ORDINALS[i] ?? ''}
                  </span>
                  <p className="text-ink-400 text-xs">
                    {item.sectionName} · {formatDate(item.publishedAt)}
                  </p>
                  <h3 className="mt-2 font-semibold font-serif text-ink-900 text-lg leading-snug transition-colors group-hover:text-brand-700">
                    {item.title}
                  </h3>
                  {item.summary !== null && item.summary !== '' ? (
                    <p className="mt-2 line-clamp-3 text-ink-500 text-sm leading-relaxed">
                      {item.summary}
                    </p>
                  ) : null}
                  <p className="mt-4 text-ink-400 text-xs">{item.authorName ?? '佚名'}</p>
                </article>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* 最新发布 */}
      <section className="py-14">
        <SectionHeading title="最新发布" />
        {latest.length > 0 ? (
          <div className="mt-4">
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
      <section id="sections" className="scroll-mt-20 border-ink-200 border-t py-14">
        <SectionHeading title="板块" sub="按求学阶段分区编纂" />
        <div className="mt-8 grid grid-cols-1 gap-4 pb-4 sm:grid-cols-2 lg:grid-cols-4">
          {topSections.map((section) => (
            <Link key={section.id} href={`/s/${section.slug}`} className="group block">
              <article className="flex h-full flex-col rounded-md border border-ink-200 bg-paper-50 p-5 shadow-paper transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-brand-300 group-hover:shadow-lift">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold font-serif text-ink-900 text-lg leading-snug">
                    {section.name}
                  </h3>
                  <Badge variant="outline">{stageLabel(section.stage)}</Badge>
                </div>
                <p className="mt-2 flex-1 text-ink-500 text-sm leading-relaxed">
                  {section.description}
                </p>
                <p className="mt-4 flex items-center gap-1 text-brand-700 text-sm opacity-0 transition-opacity group-hover:opacity-100">
                  进入板块
                  <ArrowRight aria-hidden className="h-3.5 w-3.5" />
                </p>
              </article>
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
