// 近闻详情页：单条站点新闻/公告作为可点开的文章；正文复用博客渲染器（kernel DocJson）。
import { getDb } from '@harublog/db';
import { type DocJson, validateDoc } from '@harublog/kernel';
import { ArticleRenderer } from '@harublog/renderer';
import { Megaphone } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Breadcrumb } from '@/components/breadcrumb';
import { formatDate } from '@/lib/format';
import { highlightDoc } from '@/lib/highlight';
import { renderMath } from '@/lib/math';
import { announcementExcerpt, getPublishedAnnouncement } from '@/server/announcements';

export const dynamic = 'force-dynamic';

interface NewsDetailProps {
  params: Promise<{ id: string }>;
}

function isInternal(href: string): boolean {
  return href.startsWith('/');
}

export async function generateMetadata({ params }: NewsDetailProps): Promise<Metadata> {
  const { id } = await params;
  const item = await getPublishedAnnouncement(getDb(), id);
  if (item === null) {
    return { title: '近闻不存在', robots: { index: false } };
  }
  return { title: `${item.title} · 近闻`, description: announcementExcerpt(item) };
}

export default async function NewsDetailPage({ params }: NewsDetailProps) {
  const { id } = await params;
  const item = await getPublishedAnnouncement(getDb(), id);
  if (item === null) {
    notFound();
  }

  // 富正文：校验通过则走渲染器（含代码高亮/公式）；旧行或校验失败回退纯文本镜像
  let bodyDoc: DocJson | null = null;
  let codeHighlights: Awaited<ReturnType<typeof highlightDoc>> | undefined;
  if (item.bodyDoc) {
    try {
      const validated = validateDoc(item.bodyDoc);
      bodyDoc = validated;
      codeHighlights = await highlightDoc(validated);
    } catch {
      bodyDoc = null;
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pt-8 pb-16">
      <Breadcrumb
        items={[
          { label: '首页', href: '/' },
          { label: '近闻', href: '/news' },
          { label: item.title },
        ]}
      />
      <article className="rise-in border-ink-200 border-b pt-2 pb-8">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {item.level === 'notice' ? (
            <span className="rounded-full bg-accent-50 px-2 py-0.5 font-medium text-accent-700 text-xs">
              公告
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-ink-400 text-xs">
              <Megaphone className="h-3.5 w-3.5" aria-hidden />
              近闻
            </span>
          )}
          <time dateTime={item.publishedAt.toISOString()} className="text-ink-400 text-xs">
            {formatDate(item.publishedAt)}
          </time>
          {item.authorName !== null ? (
            <span className="text-ink-400 text-xs">· {item.authorName}</span>
          ) : null}
        </div>
        <h1 className="mt-3 font-semibold font-serif text-3xl text-ink-900 leading-snug tracking-wide sm:text-4xl">
          {item.title}
        </h1>
      </article>

      {bodyDoc !== null ? (
        <div className="prose-zh mt-8">
          <ArticleRenderer
            doc={bodyDoc}
            codeHighlights={codeHighlights}
            mathRenderer={renderMath}
          />
        </div>
      ) : (
        <div className="mt-8 whitespace-pre-wrap text-base text-ink-700 leading-relaxed">
          {item.body}
        </div>
      )}

      {item.linkHref !== null ? (
        <div className="mt-8">
          {isInternal(item.linkHref) ? (
            <Link
              href={item.linkHref}
              className="inline-block rounded-sm border border-brand-300 px-4 py-2 text-brand-700 text-sm transition-colors hover:border-brand-500 hover:text-brand-900"
            >
              {item.linkLabel ?? '查看详情'} →
            </Link>
          ) : (
            <a
              href={item.linkHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block rounded-sm border border-brand-300 px-4 py-2 text-brand-700 text-sm transition-colors hover:border-brand-500 hover:text-brand-900"
            >
              {item.linkLabel ?? '查看详情'} ↗
            </a>
          )}
        </div>
      ) : null}

      <div className="mt-12 border-ink-100 border-t pt-6">
        <Link href="/news" className="text-ink-500 text-sm transition-colors hover:text-brand-700">
          ← 返回近闻
        </Link>
      </div>
    </div>
  );
}
