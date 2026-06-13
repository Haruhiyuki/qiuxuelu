// 近闻页：管理员发布的站点新闻 / 公告，按时间倒序。
import { getDb } from '@harublog/db';
import { EmptyState } from '@harublog/ui';
import { Megaphone } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumb } from '@/components/breadcrumb';
import { formatDate } from '@/lib/format';
import { listPublishedAnnouncements } from '@/server/announcements';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '近闻',
  description: '求学路的站点新闻与公告。',
};

export default async function NewsPage() {
  const items = await listPublishedAnnouncements(getDb());

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pt-8 pb-16">
      <Breadcrumb items={[{ label: '首页', href: '/' }, { label: '近闻' }]} />
      <header className="rise-in border-ink-200 border-b pt-2 pb-8">
        <h1 className="flex items-center gap-3 font-semibold font-serif text-3xl text-ink-900 tracking-wide sm:text-4xl">
          <Megaphone className="h-7 w-7 text-accent-600" aria-hidden />
          近闻
        </h1>
        <p className="mt-3 text-ink-500 text-sm">站点新闻与公告，由管理团队发布。</p>
      </header>

      {items.length > 0 ? (
        <ol className="mt-4 flex flex-col">
          {items.map((a, i) => (
            <li
              key={a.id}
              className={`relative flex gap-5 ${i === items.length - 1 ? '' : 'pb-8'}`}
            >
              {/* 时间轴 */}
              <div className="flex flex-col items-center pt-1.5">
                <span
                  aria-hidden
                  className={`h-3 w-3 shrink-0 rounded-full ${
                    a.level === 'notice' ? 'bg-accent-600' : 'bg-brand-500'
                  }`}
                />
                {i === items.length - 1 ? null : (
                  <span aria-hidden className="mt-1 w-px flex-1 bg-ink-200" />
                )}
              </div>
              <article className="group min-w-0 flex-1 pb-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {a.level === 'notice' ? (
                    <span className="rounded-full bg-accent-50 px-2 py-0.5 font-medium text-accent-700 text-xs">
                      公告
                    </span>
                  ) : null}
                  <time dateTime={a.publishedAt.toISOString()} className="text-ink-400 text-xs">
                    {formatDate(a.publishedAt)}
                  </time>
                  {a.authorName !== null ? (
                    <span className="text-ink-400 text-xs">· {a.authorName}</span>
                  ) : null}
                </div>
                <h2 className="mt-1.5 font-semibold font-serif text-ink-900 text-lg leading-snug">
                  <Link href={`/news/${a.id}`} className="transition-colors hover:text-brand-700">
                    {a.title}
                  </Link>
                </h2>
                <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-ink-600 text-sm leading-relaxed">
                  {a.body}
                </p>
                <Link
                  href={`/news/${a.id}`}
                  className="mt-3 inline-block text-brand-700 text-sm transition-colors hover:text-brand-900"
                >
                  阅读全文 →
                </Link>
              </article>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState
          icon={<Megaphone />}
          title="暂无近闻"
          description="还没有发布任何新闻或公告。"
        />
      )}
    </div>
  );
}
