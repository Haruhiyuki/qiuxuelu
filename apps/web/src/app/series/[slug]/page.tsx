// 文章系列公开页（ADR-0014）：系列头 + 有序条目。公开只露已发布，所有者另见草稿（带状态标注）。
import { Badge, EmptyState } from '@harublog/ui';
import { Layers, Pencil } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Breadcrumb } from '@/components/breadcrumb';
import { docStatusLabel } from '@/lib/doc-labels';
import { formatDate } from '@/lib/format';
import { getSession } from '@/lib/session';
import { loadSeriesBySlug, type SeriesItemRow } from '@/server/series';

export const dynamic = 'force-dynamic';

interface SeriesPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: SeriesPageProps): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadSeriesBySlug(slug);
  if (data === null) {
    return { title: '系列不存在', robots: { index: false } };
  }
  const description =
    data.head.description ?? `${data.head.ownerName ?? '佚名'} 的文章系列「${data.head.title}」`;
  return { title: data.head.title, description };
}

export default async function SeriesPage({ params }: SeriesPageProps) {
  const { slug } = await params;
  const data = await loadSeriesBySlug(slug);
  if (data === null) {
    notFound();
  }
  const { head, items } = data;
  const session = await getSession();
  const isOwner = session?.user.id === head.ownerId;

  // 公开只看已发布；所有者另见草稿/审校中
  const visible = isOwner ? items : items.filter((it) => it.status === 'published');
  const publishedCount = items.filter((it) => it.status === 'published').length;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <Breadcrumb items={[{ label: '首页', href: '/' }, { label: head.title }]} />

      {/* 系列头 */}
      <header className="rounded-2xl border border-ink-200 bg-paper-50 p-6 shadow-paper">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-on-fill shadow-paper">
            <Layers className="h-6 w-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-brand-700 text-xs tracking-wide">文章系列</p>
            <h1 className="mt-0.5 font-semibold font-serif text-2xl text-ink-900 leading-tight">
              {head.title}
            </h1>
            {head.description ? (
              <p className="mt-2 whitespace-pre-wrap text-ink-600 text-sm leading-relaxed">
                {head.description}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-500 text-sm">
              <Link
                href={`/u/${head.ownerId}`}
                className="inline-flex items-center gap-1.5 transition-colors hover:text-brand-700"
              >
                {head.ownerImage ? (
                  <img src={head.ownerImage} alt="" className="h-5 w-5 rounded-full object-cover" />
                ) : (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-paper-300 text-[10px] text-ink-600">
                    {(head.ownerName ?? '佚').charAt(0)}
                  </span>
                )}
                {head.ownerName ?? '佚名'}
              </Link>
              <span aria-hidden className="text-ink-300">
                ·
              </span>
              <span className="tabular-nums">共 {publishedCount} 篇</span>
              <span aria-hidden className="text-ink-300">
                ·
              </span>
              <span>更新于 {formatDate(head.updatedAt)}</span>
            </div>
          </div>
          {isOwner ? (
            <Link
              href={`/write/series/${head.id}`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ink-200 px-3 py-1.5 text-ink-600 text-sm transition-colors hover:border-brand-300 hover:text-brand-700"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              管理
            </Link>
          ) : null}
        </div>
      </header>

      {/* 条目列表 */}
      {visible.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={<Layers />}
            title="这个系列还没有文章"
            description={
              isOwner
                ? '去「管理」里把文章加入系列，或在系列内新建文章。'
                : '作者还没有发布该系列的文章。'
            }
          />
        </div>
      ) : (
        <ol className="mt-8 flex flex-col gap-3">
          {visible.map((it, i) => (
            <SeriesItem key={it.documentId} item={it} index={i + 1} isOwner={isOwner} />
          ))}
        </ol>
      )}
    </div>
  );
}

function SeriesItem({
  item,
  index,
  isOwner,
}: {
  item: SeriesItemRow;
  index: number;
  isOwner: boolean;
}) {
  const published = item.status === 'published';
  // 已发布 → 阅读页；所有者看到的草稿/审校 → 编辑页
  const href = published ? `/a/${item.slug}` : `/write/${item.documentId}`;
  return (
    <li>
      <Link
        href={href}
        className="group flex gap-4 rounded-xl border border-ink-100 p-4 transition-colors hover:border-brand-200 hover:bg-paper-50"
      >
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-paper-200 font-medium font-serif text-ink-500 text-sm tabular-nums transition-colors group-hover:bg-brand-100 group-hover:text-brand-700">
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-semibold font-serif text-base text-ink-900 leading-snug transition-colors group-hover:text-brand-700">
              {item.title}
            </h2>
            {isOwner && !published ? (
              <Badge variant="accent">{docStatusLabel(item.status)}</Badge>
            ) : null}
          </div>
          {item.summary ? (
            <p className="mt-1 line-clamp-2 text-ink-600 text-sm leading-relaxed">{item.summary}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-400 text-xs">
            <span>{item.sectionName}</span>
            {item.publishedAt !== null ? (
              <time dateTime={item.publishedAt.toISOString()}>{formatDate(item.publishedAt)}</time>
            ) : null}
          </div>
        </div>
      </Link>
    </li>
  );
}
