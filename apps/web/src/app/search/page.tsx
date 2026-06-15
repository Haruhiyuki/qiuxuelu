import { EmptyState } from '@harublog/ui';
import { SearchX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumb } from '@/components/breadcrumb';
import { Pagination } from '@/components/pagination';
import { SearchSnippet } from '@/components/search/search-snippet';
import { runSearch, type SearchGroup, type SearchSort } from '@/server/search';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: '搜索', robots: { index: false } };

interface SearchPageProps {
  searchParams: Promise<{
    q?: string;
    page?: string;
    section?: string;
    sort?: string;
  }>;
}

const PAGE_SIZE = 20;

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const sp = await searchParams;
  const query = (sp.q ?? '').trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const section = typeof sp.section === 'string' && sp.section.length > 0 ? sp.section : null;
  const sort: SearchSort = sp.sort === 'newest' ? 'newest' : 'relevance';

  const result =
    query.length > 0
      ? await runSearch({
          query,
          page,
          pageSize: PAGE_SIZE,
          sectionSlug: section,
          sort,
          withFacets: true,
        })
      : null;
  const groups = result?.groups ?? [];
  const total = result?.total ?? 0;
  const sectionFacets = result?.sectionFacets ?? [];
  const failed = result?.failed ?? false;

  // 保留查询态的链接构造（切板块/排序回到第 1 页）
  const hrefWith = (next: { section?: string | null; sort?: SearchSort; page?: number }) => {
    const params = new URLSearchParams({ q: query });
    const sec = next.section !== undefined ? next.section : section;
    const srt = next.sort ?? sort;
    if (sec !== null && sec !== undefined) {
      params.set('section', sec);
    }
    if (srt === 'newest') {
      params.set('sort', 'newest');
    }
    if (next.page !== undefined && next.page > 1) {
      params.set('page', String(next.page));
    }
    return `/search?${params.toString()}`;
  };

  const activeSectionName =
    section !== null ? sectionFacets.find((f) => f.slug === section)?.name : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <Breadcrumb items={[{ label: '首页', href: '/' }, { label: '搜索' }]} />
      <h1 className="font-semibold font-serif text-2xl text-ink-900">搜索</h1>

      <form method="get" action="/search" className="mt-4 flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="搜索文章、作者或标签…"
          aria-label="搜索关键词"
          className="h-11 flex-1 rounded-lg border border-ink-300 bg-paper-50 px-3.5 text-ink-900 placeholder:text-ink-400 focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
        />
        <button
          type="submit"
          className="rounded-lg bg-fill px-5 font-medium text-on-fill transition-colors hover:bg-fill-hover"
        >
          搜索
        </button>
      </form>

      {query.length === 0 ? (
        <p className="mt-8 text-ink-500 text-sm">
          按标题、正文、作者或标签搜索。任意页面按{' '}
          <kbd className="rounded border border-ink-200 px-1.5 py-0.5 font-sans text-xs">⌘K</kbd>{' '}
          也能快速搜索。
        </p>
      ) : failed ? (
        <p className="mt-8 text-accent-700 text-sm">搜索服务暂时不可用，请稍后再试。</p>
      ) : total === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={<SearchX />}
            title={`没有找到与「${query}」相关的内容`}
            description="换个关键词，或试试作者名、标签。"
          />
        </div>
      ) : (
        <>
          {/* 板块分面 + 排序 */}
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Chip href={hrefWith({ section: null, page: 1 })} active={section === null}>
              全部板块
            </Chip>
            {sectionFacets.map((f) => (
              <Chip
                key={f.slug}
                href={hrefWith({ section: f.slug, page: 1 })}
                active={section === f.slug}
              >
                {f.name}
                <span className="ml-1 text-xs opacity-70">{f.count}</span>
              </Chip>
            ))}
            <div className="ml-auto flex items-center gap-1 rounded-full border border-ink-200 p-0.5 text-sm">
              <SortBtn
                href={hrefWith({ sort: 'relevance', page: 1 })}
                active={sort === 'relevance'}
              >
                相关度
              </SortBtn>
              <SortBtn href={hrefWith({ sort: 'newest', page: 1 })} active={sort === 'newest'}>
                最新
              </SortBtn>
            </div>
          </div>

          <p className="mt-5 text-ink-500 text-sm">
            约 {total} 篇相关文章
            {activeSectionName != null ? ` · 板块「${activeSectionName}」` : ''}
          </p>

          <SearchResults groups={groups} />

          <Pagination
            page={page}
            hasNext={total > page * PAGE_SIZE}
            basePath="/search"
            params={{
              q: query,
              ...(section !== null ? { section } : {}),
              ...(sort === 'newest' ? { sort } : {}),
            }}
          />
        </>
      )}
    </div>
  );
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-sm transition-colors ${
        active
          ? 'border-brand-500 bg-brand-50 text-brand-800'
          : 'border-ink-200 text-ink-600 hover:border-brand-300 hover:text-brand-700'
      }`}
    >
      {children}
    </Link>
  );
}

function SortBtn({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 transition-colors ${
        active ? 'bg-fill text-on-fill' : 'text-ink-500 hover:text-ink-800'
      }`}
    >
      {children}
    </Link>
  );
}

function SearchResults({ groups }: { groups: SearchGroup[] }) {
  return (
    <ul className="mt-4 flex flex-col gap-3">
      {groups.map((g) => {
        const best = g.hits[0];
        return (
          <li
            key={g.docId}
            className="rounded-xl border border-ink-100 p-4 transition-colors hover:border-ink-200"
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-ink-400 text-xs">
              <span>{g.sectionName}</span>
              <span aria-hidden>·</span>
              <span>{g.authorName.length > 0 ? g.authorName : '佚名'}</span>
            </div>
            <Link
              href={`/a/${g.slug}`}
              className="mt-0.5 inline-block font-semibold font-serif text-ink-900 text-lg leading-snug transition-colors hover:text-brand-700"
            >
              {g.title}
            </Link>
            {best !== undefined ? (
              <Link
                href={`/a/${g.slug}#b-${best.blockId}`}
                className="mt-1 block rounded-md px-3 py-2 text-ink-600 text-sm leading-relaxed transition-colors hover:bg-paper-200"
              >
                {/* 高亮片段来自 Meilisearch，仅含受控 <mark>；SearchSnippet 安全重建 */}
                <SearchSnippet html={best.snippet} />
              </Link>
            ) : null}
            {g.tags.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {g.tags.slice(0, 4).map((t) => (
                  <Link
                    key={t}
                    href={`/t/${encodeURIComponent(t)}`}
                    className="rounded-full bg-paper-200 px-2 py-0.5 text-ink-500 text-xs transition-colors hover:bg-paper-300 hover:text-brand-700"
                  >
                    #{t}
                  </Link>
                ))}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
