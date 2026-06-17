// 博客底部系列导航卡（ADR-0014）：所属系列 + 第 N/共 M 篇 + 上一篇/下一篇（仅已发布范围）。
import { ChevronLeft, ChevronRight, Layers } from 'lucide-react';
import Link from 'next/link';
import type { SeriesNav as SeriesNavData } from '@/server/series';

export function SeriesNav({ nav }: { nav: SeriesNavData }) {
  return (
    <nav
      aria-label="博客系列导航"
      className="rounded-xl border border-ink-200 bg-paper-50 p-5 shadow-paper"
    >
      <Link href={`/series/${nav.seriesSlug}`} className="group flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-on-fill">
          <Layers className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block text-ink-400 text-xs">
            本文属于系列 · 第 {nav.index}/{nav.total} 篇
          </span>
          <span className="block truncate font-medium font-serif text-ink-900 transition-colors group-hover:text-brand-700">
            {nav.seriesTitle}
          </span>
        </span>
      </Link>

      {nav.prev !== null || nav.next !== null ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {nav.prev !== null ? (
            <Link
              href={`/a/${nav.prev.slug}`}
              className="group flex items-center gap-2 rounded-lg border border-ink-100 px-3 py-2.5 transition-colors hover:border-brand-200 hover:bg-paper-100"
            >
              <ChevronLeft
                className="h-4 w-4 shrink-0 text-ink-400 group-hover:text-brand-600"
                aria-hidden
              />
              <span className="min-w-0">
                <span className="block text-ink-400 text-xs">上一篇</span>
                <span className="block truncate text-ink-700 text-sm group-hover:text-brand-700">
                  {nav.prev.title}
                </span>
              </span>
            </Link>
          ) : (
            <span aria-hidden className="hidden sm:block" />
          )}
          {nav.next !== null ? (
            <Link
              href={`/a/${nav.next.slug}`}
              className="group flex items-center justify-end gap-2 rounded-lg border border-ink-100 px-3 py-2.5 text-right transition-colors hover:border-brand-200 hover:bg-paper-100"
            >
              <span className="min-w-0">
                <span className="block text-ink-400 text-xs">下一篇</span>
                <span className="block truncate text-ink-700 text-sm group-hover:text-brand-700">
                  {nav.next.title}
                </span>
              </span>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-ink-400 group-hover:text-brand-600"
                aria-hidden
              />
            </Link>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}
