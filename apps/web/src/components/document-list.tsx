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
}

/** 已发布文章列表（首页 / 板块页共用），标题链向文章阅读页 /a/[slug]。 */
export function DocumentList({ items }: { items: DocumentListItem[] }) {
  return (
    <ul className="divide-y divide-ink-100">
      {items.map((item) => (
        <li key={item.id} className="py-5">
          <article>
            <h3 className="font-serif text-lg font-semibold leading-snug text-ink-900">
              <Link href={`/a/${item.slug}`} className="transition-colors hover:text-brand-700">
                {item.title}
              </Link>
            </h3>
            {item.summary !== null && item.summary !== '' ? (
              <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-ink-600">
                {item.summary}
              </p>
            ) : null}
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
              {item.sectionName !== undefined && item.sectionSlug !== undefined ? (
                <Link href={`/s/${item.sectionSlug}`} className="hover:text-brand-700">
                  <Badge variant="brand">{item.sectionName}</Badge>
                </Link>
              ) : null}
              <span>{item.authorName ?? '佚名'}</span>
              <time dateTime={item.publishedAt.toISOString()}>{formatDate(item.publishedAt)}</time>
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}
