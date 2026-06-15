import { Badge } from '@harublog/ui';
import Link from 'next/link';
import { formatDate } from '@/lib/format';

export interface DocumentListItem {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  publishedAt: Date;
  authorName: string | null;
  /** 板块信息可选：板块页内的列表无需重复展示所属板块 */
  sectionName?: string;
  sectionSlug?: string;
  /** 精选：列表内标注「精选」徽标（首页混排时用） */
  featured?: boolean;
}

/**
 * 已发布文章列表（首页 / 板块页共用），标题链向文章阅读页 /a/[slug]。
 * 整行可点（标题链接铺满行块），日期在宽屏靠右对齐形成时间轴感。
 */
export function DocumentList({ items }: { items: DocumentListItem[] }) {
  return (
    <ul className="divide-y divide-ink-100">
      {items.map((item) => (
        <li key={item.id}>
          <article className="group -mx-3 relative rounded-sm px-3 py-5 transition-colors hover:bg-paper-50">
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="font-semibold font-serif text-ink-900 text-lg leading-snug">
                <Link
                  href={`/a/${item.slug}`}
                  className="transition-colors after:absolute after:inset-0 group-hover:text-brand-700"
                >
                  {item.title}
                </Link>
              </h3>
              <time
                dateTime={item.publishedAt.toISOString()}
                className="hidden shrink-0 text-ink-400 text-xs tabular-nums sm:block"
              >
                {formatDate(item.publishedAt)}
              </time>
            </div>
            {item.summary !== null && item.summary !== '' ? (
              <p className="mt-1.5 line-clamp-2 max-w-2xl text-ink-600 text-sm leading-relaxed">
                {item.summary}
              </p>
            ) : null}
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-500 text-xs">
              {item.featured ? <Badge variant="accent">精选</Badge> : null}
              {item.sectionName !== undefined && item.sectionSlug !== undefined ? (
                <Link
                  href={`/?section=${item.sectionSlug}`}
                  className="relative z-10 hover:text-brand-700"
                >
                  <Badge variant="brand">{item.sectionName}</Badge>
                </Link>
              ) : null}
              <span>{item.authorName ?? '佚名'}</span>
              <time dateTime={item.publishedAt.toISOString()} className="sm:hidden">
                {formatDate(item.publishedAt)}
              </time>
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}
