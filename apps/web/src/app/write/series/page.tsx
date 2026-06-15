// 「我的系列」：作者的全部系列 + 新建。管理入口归在写作区下（/write/series）。
import { EmptyState } from '@harublog/ui';
import { ChevronRight, ExternalLink, Layers } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Breadcrumb } from '@/components/breadcrumb';
import { CreateSeriesForm } from '@/components/series/create-series-form';
import { formatDate } from '@/lib/format';
import { getSession } from '@/lib/session';
import { listUserSeries } from '@/server/series';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: '我的系列' };

export default async function MySeriesPage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  const list = await listUserSeries(session.user.id);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <Breadcrumb items={[{ label: '我的写作', href: '/write' }, { label: '我的系列' }]} />
      <h1 className="font-semibold font-serif text-2xl text-ink-900">我的系列</h1>
      <p className="mt-2 text-ink-500 text-sm">
        把多篇文章编排成有序合集，读者可在文章底部顺序阅读。
      </p>

      <div className="mt-6">
        <CreateSeriesForm />
      </div>

      {list.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={<Layers />}
            title="还没有系列"
            description="新建一个系列，把相关文章组织起来。"
          />
        </div>
      ) : (
        <ul className="mt-8 flex flex-col gap-3">
          {list.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-3 rounded-xl border border-ink-100 p-4 transition-colors hover:border-brand-200 hover:bg-paper-50"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-on-fill">
                <Layers className="h-5 w-5" aria-hidden />
              </span>
              <Link href={`/write/series/${s.id}`} className="group min-w-0 flex-1">
                <span className="flex items-center gap-1 font-medium font-serif text-ink-900 transition-colors group-hover:text-brand-700">
                  <span className="truncate">{s.title}</span>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-ink-300 group-hover:text-brand-500"
                    aria-hidden
                  />
                </span>
                <span className="mt-0.5 block text-ink-400 text-xs tabular-nums">
                  {s.total} 篇（{s.published} 已发布） · 更新于 {formatDate(s.updatedAt)}
                </span>
              </Link>
              <Link
                href={`/series/${s.slug}`}
                aria-label="查看系列页"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-400 transition-colors hover:bg-paper-200 hover:text-brand-700"
              >
                <ExternalLink className="h-4 w-4" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
