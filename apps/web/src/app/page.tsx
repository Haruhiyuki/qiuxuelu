// 首页：双列信息流。左列 = 板块（上）+ 标签（下，内滚动），可板块×标签交叉筛选；
// 右列 = 文章列表，多种排序（默认最新），精选文章分散插入第一页并标注，分页在右列。
import {
  docReactions,
  documents,
  documentTags,
  getDb,
  publishedSnapshots,
  sections,
  tags,
  user as userTable,
} from '@harublog/db';
import { EmptyState } from '@harublog/ui';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { PenLine } from 'lucide-react';
import Link from 'next/link';
import { AnnouncementBar } from '@/components/announcement-bar';
import { ButtonLink } from '@/components/button-link';
import { DocumentList, type DocumentListItem } from '@/components/document-list';
import { Pagination } from '@/components/pagination';
import { getSession } from '@/lib/session';
import { getHomepageBanner } from '@/server/announcements';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 10;
const FEATURED_ON_FIRST = 4;
const TAG_LIMIT = 50;

type SortKey = 'time' | 'popular' | 'old';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'time', label: '最新' },
  { key: 'popular', label: '最热' },
  { key: 'old', label: '最早' },
];

interface ArticleRow {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  publishedAt: Date;
  authorName: string | null;
  sectionName: string;
  sectionSlug: string;
}

const ARTICLE_FIELDS = {
  id: documents.id,
  title: documents.title,
  slug: documents.slug,
  summary: documents.summary,
  publishedAt: publishedSnapshots.publishedAt,
  authorName: userTable.name,
  sectionName: sections.name,
  sectionSlug: sections.slug,
};

/** 交叉筛选 where 片段：已发布 + 可选板块 + 可选标签 + 是否精选 */
function articleConds(sectionId: string | null, tag: string | null, featured: boolean) {
  const conds = [eq(documents.status, 'published'), eq(documents.featured, featured)];
  if (sectionId !== null) {
    conds.push(eq(documents.sectionId, sectionId));
  }
  if (tag !== null) {
    conds.push(
      sql`exists (select 1 from ${documentTags} dt join ${tags} t on t.id = dt.tag_id where dt.document_id = ${documents.id} and t.name = ${tag})`,
    );
  }
  return and(...conds);
}

function baseQuery() {
  return getDb()
    .select(ARTICLE_FIELDS)
    .from(documents)
    .innerJoin(publishedSnapshots, eq(publishedSnapshots.documentId, documents.id))
    .innerJoin(sections, eq(sections.id, documents.sectionId))
    .leftJoin(userTable, eq(userTable.id, documents.ownerId));
}

/** 非精选文章：交叉筛选 + 排序 + 分页（多取一条判 hasNext） */
async function fetchArticles(
  sectionId: string | null,
  tag: string | null,
  sort: SortKey,
  page: number,
): Promise<{ rows: ArticleRow[]; hasNext: boolean }> {
  const likeCount = sql<number>`(select count(*) from ${docReactions} where ${docReactions.documentId} = ${documents.id} and ${docReactions.kind} = 'like')`;
  const order =
    sort === 'popular'
      ? [desc(likeCount), desc(publishedSnapshots.publishedAt)]
      : sort === 'old'
        ? [asc(publishedSnapshots.publishedAt)]
        : [desc(publishedSnapshots.publishedAt)];
  const rows = await baseQuery()
    .where(articleConds(sectionId, tag, false))
    .orderBy(...order)
    .limit(PAGE_SIZE + 1)
    .offset((page - 1) * PAGE_SIZE);
  return { rows: rows.slice(0, PAGE_SIZE), hasNext: rows.length > PAGE_SIZE };
}

/** 精选文章（同样受交叉筛选约束）：仅第一页混排用 */
async function fetchFeatured(sectionId: string | null, tag: string | null): Promise<ArticleRow[]> {
  return baseQuery()
    .where(articleConds(sectionId, tag, true))
    .orderBy(desc(publishedSnapshots.publishedAt))
    .limit(FEATURED_ON_FIRST);
}

async function fetchSections() {
  const db = getDb();
  const [list, counts] = await Promise.all([
    db.select().from(sections).where(isNull(sections.parentId)).orderBy(asc(sections.position)),
    db
      .select({ sectionId: documents.sectionId, n: sql<number>`count(*)::int` })
      .from(documents)
      .innerJoin(publishedSnapshots, eq(publishedSnapshots.documentId, documents.id))
      .where(eq(documents.status, 'published'))
      .groupBy(documents.sectionId),
  ]);
  const countBy = new Map(counts.map((c) => [c.sectionId, Number(c.n)]));
  const total = counts.reduce((s, c) => s + Number(c.n), 0);
  return { list, countBy, total };
}

/** 全站标签 + 各自已发布篇数（按篇数降序），左列标签列表用 */
async function fetchTags() {
  return getDb()
    .select({ name: tags.name, n: sql<number>`count(*)::int` })
    .from(documentTags)
    .innerJoin(tags, eq(tags.id, documentTags.tagId))
    .innerJoin(documents, eq(documents.id, documentTags.documentId))
    .innerJoin(publishedSnapshots, eq(publishedSnapshots.documentId, documents.id))
    .where(eq(documents.status, 'published'))
    .groupBy(tags.name)
    .orderBy(desc(sql`count(*)`), tags.name)
    .limit(TAG_LIMIT);
}

/** 把精选条目均匀散布进常规列表（第一页） */
function interleave(regular: DocumentListItem[], featured: DocumentListItem[]): DocumentListItem[] {
  if (featured.length === 0) {
    return regular;
  }
  const out = [...regular];
  const step = Math.max(1, Math.ceil(out.length / (featured.length + 1)));
  featured.forEach((f, k) => {
    const pos = Math.min(out.length, (k + 1) * step + k);
    out.splice(pos, 0, f);
  });
  return out;
}

/** 构造筛选/排序链接（改筛选即回到第一页） */
function hrefOf(section: string | null, tag: string | null, sort: SortKey): string {
  const sp = new URLSearchParams();
  if (section !== null) {
    sp.set('section', section);
  }
  if (tag !== null) {
    sp.set('tag', tag);
  }
  if (sort !== 'time') {
    sp.set('sort', sort);
  }
  const q = sp.toString();
  return q.length > 0 ? `/?${q}` : '/';
}

function toItem(r: ArticleRow, featured: boolean): DocumentListItem {
  return {
    id: r.id,
    title: r.title,
    slug: r.slug,
    summary: r.summary,
    publishedAt: r.publishedAt,
    authorName: r.authorName ?? null,
    sectionName: r.sectionName,
    sectionSlug: r.sectionSlug,
    featured,
  };
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; tag?: string; sort?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const sectionSlug = typeof sp.section === 'string' && sp.section.length > 0 ? sp.section : null;
  const activeTag = typeof sp.tag === 'string' && sp.tag.length > 0 ? sp.tag : null;
  const sort: SortKey = sp.sort === 'popular' || sp.sort === 'old' ? sp.sort : 'time';
  const page = Math.max(1, Number(sp.page) || 1);

  const [{ list: sectionList, countBy, total }, tagList, banner, session] = await Promise.all([
    fetchSections(),
    fetchTags(),
    getHomepageBanner(getDb()),
    getSession(),
  ]);

  const activeSection =
    sectionSlug !== null ? (sectionList.find((s) => s.slug === sectionSlug) ?? null) : null;
  const sectionId = activeSection?.id ?? null;

  const [{ rows, hasNext }, featuredRows] = await Promise.all([
    fetchArticles(sectionId, activeTag, sort, page),
    page === 1 ? fetchFeatured(sectionId, activeTag) : Promise.resolve([]),
  ]);

  const items =
    page === 1
      ? interleave(
          rows.map((r) => toItem(r, false)),
          featuredRows.map((r) => toItem(r, true)),
        )
      : rows.map((r) => toItem(r, false));

  const writeHref = session ? '/write/new' : '/register';
  const pageParams: Record<string, string> = {};
  if (sectionSlug !== null) {
    pageParams.section = sectionSlug;
  }
  if (activeTag !== null) {
    pageParams.tag = activeTag;
  }
  if (sort !== 'time') {
    pageParams.sort = sort;
  }

  const scopeLabel = `${activeSection?.name ?? '全部文章'}${activeTag !== null ? ` · #${activeTag}` : ''}`;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6">
      {banner !== null ? (
        <div className="mb-6">
          <AnnouncementBar
            id={banner.id}
            title={banner.title}
            level={banner.level}
            linkHref={banner.linkHref}
            linkLabel={banner.linkLabel}
          />
        </div>
      ) : null}

      <div className="grid items-start gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
        {/* 左列：板块 + 标签（交叉筛选） */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="rounded-lg border border-ink-200 bg-paper-50 p-4 shadow-paper">
            <h2 className="px-1 font-medium font-serif text-ink-500 text-xs tracking-wide">板块</h2>
            <ul className="mt-2 flex flex-col gap-0.5">
              <FilterRow
                href={hrefOf(null, activeTag, sort)}
                active={sectionId === null}
                label="全部"
                count={total}
              />
              {sectionList.map((s) => (
                <FilterRow
                  key={s.id}
                  href={hrefOf(s.slug, activeTag, sort)}
                  active={activeSection?.id === s.id}
                  label={s.name}
                  count={countBy.get(s.id) ?? 0}
                />
              ))}
            </ul>

            <div className="my-3 border-ink-200/70 border-t" />

            <h2 className="px-1 font-medium font-serif text-ink-500 text-xs tracking-wide">标签</h2>
            <div className="mt-2 max-h-72 overflow-y-auto pr-1">
              <div className="flex flex-wrap gap-1.5">
                <TagChip
                  href={hrefOf(sectionSlug, null, sort)}
                  active={activeTag === null}
                  label="全部"
                />
                {tagList.map((t) => (
                  <TagChip
                    key={t.name}
                    href={hrefOf(sectionSlug, t.name, sort)}
                    active={activeTag === t.name}
                    label={`#${t.name}`}
                  />
                ))}
              </div>
              {tagList.length === 0 ? (
                <p className="px-1 py-2 text-ink-400 text-xs">还没有标签。</p>
              ) : null}
            </div>
          </div>
        </aside>

        {/* 右列：文章列表 + 排序 + 分页 */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-ink-200 border-b pb-3">
            <p className="font-medium font-serif text-ink-800">{scopeLabel}</p>
            <nav aria-label="排序" className="flex items-center gap-1 text-sm">
              {SORTS.map((s) => {
                const on = sort === s.key;
                return (
                  <Link
                    key={s.key}
                    href={hrefOf(sectionSlug, activeTag, s.key)}
                    aria-current={on ? 'true' : undefined}
                    className={
                      on
                        ? 'rounded-full bg-brand-100 px-3 py-1 font-medium text-brand-800'
                        : 'rounded-full px-3 py-1 text-ink-500 transition-colors hover:bg-paper-200 hover:text-ink-800'
                    }
                  >
                    {s.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          {items.length > 0 ? (
            <div className="mt-2">
              <DocumentList items={items} />
            </div>
          ) : (
            <div className="mt-4">
              <EmptyState
                icon={<PenLine />}
                title={
                  sectionId !== null || activeTag !== null
                    ? '该筛选下还没有文章'
                    : '还没有发布的文章'
                }
                description={
                  sectionId !== null || activeTag !== null
                    ? '换个板块或标签看看，或清除筛选浏览全部。'
                    : '第一篇求学经验，由你来写——注册后即可起草。'
                }
                action={
                  sectionId !== null || activeTag !== null ? (
                    <ButtonLink href="/">查看全部</ButtonLink>
                  ) : (
                    <ButtonLink href={writeHref}>开始写作</ButtonLink>
                  )
                }
              />
            </div>
          )}

          <Pagination page={page} hasNext={hasNext} basePath="/" params={pageParams} />
        </div>
      </div>
    </div>
  );
}

function FilterRow({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
}) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? 'true' : undefined}
        className={`flex items-center justify-between gap-2 rounded-sm px-2.5 py-1.5 text-sm transition-colors ${
          active
            ? 'bg-brand-100 font-medium text-brand-800'
            : 'text-ink-600 hover:bg-paper-200 hover:text-ink-900'
        }`}
      >
        <span className="truncate">{label}</span>
        <span className="shrink-0 text-xs tabular-nums opacity-70">{count}</span>
      </Link>
    </li>
  );
}

function TagChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
        active
          ? 'border-brand-400 bg-brand-50 font-medium text-brand-800'
          : 'border-ink-200 text-ink-600 hover:border-brand-300 hover:text-brand-700'
      }`}
    >
      {label}
    </Link>
  );
}
