// 首页：双列信息流。左列 = 板块（上）+ 标签（下，内滚动），可板块×标签交叉筛选；
// 右列 = 文章列表，多种排序（默认最新），精选文章分散插入第一页并标注，分页在右列。
import { SITE_DESCRIPTION } from '@harublog/config';
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
import { ArrowRight, Megaphone, PenLine } from 'lucide-react';
import Link from 'next/link';
import { ButtonLink } from '@/components/button-link';
import { DocumentList, type DocumentListItem } from '@/components/document-list';
import { HomeFilterDrawer } from '@/components/home-filter-drawer';
import { Pagination } from '@/components/pagination';
import { getSession } from '@/lib/session';
import { getHomepageBanner } from '@/server/announcements';
import { getSectionTags } from '@/server/section-tags';

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

/** 全站标签 + 各自已发布篇数（按篇数降序），左列标签列表用（未选板块时）。
 *  返回形状与 getSectionTags 一致：{ name, count } */
async function fetchTags(): Promise<{ name: string; count: number }[]> {
  const rows = await getDb()
    .select({ name: tags.name, count: sql<number>`count(*)::int` })
    .from(documentTags)
    .innerJoin(tags, eq(tags.id, documentTags.tagId))
    .innerJoin(documents, eq(documents.id, documentTags.documentId))
    .innerJoin(publishedSnapshots, eq(publishedSnapshots.documentId, documents.id))
    .where(eq(documents.status, 'published'))
    .groupBy(tags.name)
    .orderBy(desc(sql`count(*)`), tags.name)
    .limit(TAG_LIMIT);
  return rows.map((r) => ({ name: r.name, count: Number(r.count) }));
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

  const db = getDb();
  // 先解析板块（决定标签列表是全站还是该板块内）
  const { list: sectionList, countBy, total } = await fetchSections();
  const activeSection =
    sectionSlug !== null ? (sectionList.find((s) => s.slug === sectionSlug) ?? null) : null;
  const sectionId = activeSection?.id ?? null;

  const [tagList, { rows, hasNext }, featuredRows, banner, session] = await Promise.all([
    // 选中板块时只列该板块包含的标签，否则列全站标签
    sectionId !== null ? getSectionTags(db, sectionId) : fetchTags(),
    fetchArticles(sectionId, activeTag, sort, page),
    page === 1 ? fetchFeatured(sectionId, activeTag) : Promise.resolve([] as ArticleRow[]),
    getHomepageBanner(db),
    getSession(),
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

  // 筛选内容（板块 + 标签）：桌面左栏与移动抽屉共用；外层容器给定高度，标签区 flex-1 填充滚动
  const renderFilter = () => (
    <nav aria-label="筛选" className="flex h-full min-h-0 flex-col">
      <FilterHeading label="板块" />
      <ul className="mt-3 flex flex-wrap gap-1.5 lg:flex-col lg:gap-0.5">
        <li>
          <CategoryItem
            href={hrefOf(null, activeTag, sort)}
            label="全部"
            count={total}
            active={sectionId === null}
          />
        </li>
        {sectionList.map((s) => (
          <li key={s.id}>
            <CategoryItem
              href={hrefOf(s.slug, activeTag, sort)}
              label={s.name}
              count={countBy.get(s.id) ?? 0}
              active={activeSection?.id === s.id}
            />
          </li>
        ))}
      </ul>

      <div className="my-4 shrink-0 border-ink-200/70 border-t" />

      <FilterHeading label="标签" />
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
        <ul className="flex flex-wrap gap-1.5 lg:flex-col lg:gap-0.5">
          <li>
            <CategoryItem
              href={hrefOf(sectionSlug, null, sort)}
              label="全部"
              active={activeTag === null}
            />
          </li>
          {tagList.map((t) => (
            <li key={t.name}>
              <CategoryItem
                href={hrefOf(sectionSlug, t.name, sort)}
                label={`#${t.name}`}
                count={t.count}
                active={activeTag === t.name}
              />
            </li>
          ))}
        </ul>
        {tagList.length === 0 ? (
          <p className="px-1 py-2 text-ink-400 text-xs">还没有标签。</p>
        ) : null}
      </div>
    </nav>
  );

  // 公告融进标语块的低调入口：内链用 Link、外链用 <a>；无显式链接指向该公告的近闻页
  const bannerHref = banner !== null ? (banner.linkHref ?? `/news/${banner.id}`) : null;
  const bannerExternal = bannerHref !== null && !bannerHref.startsWith('/');

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6">
      {/* 精简标语：保留「共笔·互校·开放」的气质，去掉旧版的板块/写作按钮，改导向社区公约 */}
      {/* 不加底部分割线：下方列表头部已有一条，避免两条线并排 */}
      <section className="rise-in mb-6">
        {/* 置顶公告：作为低调小药丸融入标语顶部（不再整条铺底、不可永久关闭） */}
        {banner !== null && bannerHref !== null ? (
          bannerExternal ? (
            <a
              href={bannerHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mb-4 inline-flex max-w-full items-center gap-1.5 rounded-full border border-ink-200 bg-paper-50 py-1 pr-2.5 pl-2 text-ink-500 text-xs transition-colors hover:border-brand-300 hover:text-brand-700"
            >
              <Megaphone className="h-3.5 w-3.5 shrink-0 text-brand-500" aria-hidden />
              <span className="truncate">{banner.title}</span>
              <ArrowRight className="h-3 w-3 shrink-0" aria-hidden />
            </a>
          ) : (
            <Link
              href={bannerHref}
              className="mb-4 inline-flex max-w-full items-center gap-1.5 rounded-full border border-ink-200 bg-paper-50 py-1 pr-2.5 pl-2 text-ink-500 text-xs transition-colors hover:border-brand-300 hover:text-brand-700"
            >
              <Megaphone className="h-3.5 w-3.5 shrink-0 text-brand-500" aria-hidden />
              <span className="truncate">{banner.title}</span>
              <ArrowRight className="h-3 w-3 shrink-0" aria-hidden />
            </Link>
          )
        ) : null}
        <p className="flex items-center gap-3 text-ink-500 text-sm tracking-[0.3em]">
          <span aria-hidden className="h-px w-8 bg-accent-600" />
          共笔 · 互校 · 开放
        </p>
        <h1 className="mt-3 max-w-2xl font-semibold font-serif text-2xl text-ink-900 leading-snug tracking-wide sm:text-3xl">
          把走过的路，写成后来者的地图
        </h1>
        <p className="mt-2 max-w-xl text-ink-500 text-sm leading-relaxed">{SITE_DESCRIPTION}</p>
        <Link
          href="/covenant"
          className="mt-3 inline-flex items-center gap-1 text-brand-700 text-sm transition-colors hover:text-brand-900"
        >
          了解社区公约
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </section>

      <div className="grid items-start gap-x-10 gap-y-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        {/* 左列（桌面）：板块 + 标签，撑满屏高；移动端隐藏，改用右列「筛选」抽屉 */}
        <aside className="hidden lg:sticky lg:top-24 lg:block lg:h-[calc(100vh-7rem)] lg:self-start">
          {renderFilter()}
        </aside>

        {/* 右列：文章列表 + 排序 + 分页 */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-ink-200 border-b pb-3">
            <div className="flex items-center gap-3">
              {/* 移动端筛选抽屉触发（桌面隐藏） */}
              <HomeFilterDrawer>{renderFilter()}</HomeFilterDrawer>
              <p className="font-medium font-serif text-ink-800">{scopeLabel}</p>
            </div>
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

/** 左列小标题：朱砂短竖标 + 字距标签（仿板块页「分类」） */
function FilterHeading({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 font-medium text-ink-400 text-xs tracking-[0.2em]">
      <span aria-hidden className="h-3 w-0.5 rounded-xs bg-accent-600" />
      {label}
    </p>
  );
}

/** 分类项：横排（窄屏）= 胶囊，竖排（宽屏）= 行，命中态高亮；count 可选。 */
function CategoryItem({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count?: number;
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
      {count !== undefined ? (
        <span className="shrink-0 text-ink-400 text-xs tabular-nums">{count}</span>
      ) : null}
    </Link>
  );
}
