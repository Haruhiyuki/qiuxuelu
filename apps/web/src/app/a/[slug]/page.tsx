import {
  documents,
  getDb,
  publishedSnapshots,
  revisions,
  sections,
  user as userTable,
} from '@harublog/db';
import { extractText, validateDoc } from '@harublog/kernel';
import type { TocEntry } from '@harublog/renderer';
import { ArticleRenderer, extractToc } from '@harublog/renderer';
import { and, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDate } from '@/lib/format';

// M0 一律请求期动态渲染；ISR + revalidateTag 是 M1 的事
export const dynamic = 'force-dynamic';

interface ArticlePageProps {
  params: Promise<{ slug: string }>;
}

async function loadArticle(slug: string) {
  const db = getDb();
  const rows = await db
    .select({
      docId: documents.id,
      slug: documents.slug,
      title: documents.title,
      summary: documents.summary,
      content: publishedSnapshots.content,
      publishedAt: publishedSnapshots.publishedAt,
      seq: revisions.seq,
      revisedAt: revisions.createdAt,
      sectionName: sections.name,
      sectionSlug: sections.slug,
      authorName: userTable.name,
    })
    .from(documents)
    .innerJoin(publishedSnapshots, eq(publishedSnapshots.documentId, documents.id))
    .innerJoin(revisions, eq(revisions.id, publishedSnapshots.revisionId))
    .innerJoin(sections, eq(sections.id, documents.sectionId))
    .leftJoin(userTable, eq(userTable.id, documents.ownerId))
    .where(and(eq(documents.slug, slug), eq(documents.status, 'published')))
    .limit(1);
  return rows[0] ?? null;
}

function buildDescription(summary: string | null, content: unknown): string {
  if (summary !== null && summary.length > 0) {
    return summary;
  }
  try {
    const text = extractText(validateDoc(content)).replaceAll('\n', ' ').trim();
    return text.slice(0, 120);
  } catch {
    return '';
  }
}

export async function generateMetadata({ params }: ArticlePageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = await loadArticle(slug);
  if (!article) {
    return { title: '文章不存在' };
  }
  const description = buildDescription(article.summary, article.content);
  return {
    title: article.title,
    description,
    openGraph: {
      title: article.title,
      description,
      type: 'article',
      publishedTime: article.publishedAt.toISOString(),
      modifiedTime: article.revisedAt.toISOString(),
    },
  };
}

export default async function ArticlePage({ params }: ArticlePageProps) {
  const { slug } = await params;
  const article = await loadArticle(slug);
  if (!article) {
    notFound();
  }

  // 目录从已校验文档提取；校验失败时正文交给 ArticleRenderer 的容错占位，目录留空
  let toc: TocEntry[] = [];
  try {
    toc = extractToc(validateDoc(article.content));
  } catch {
    toc = [];
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10 lg:grid lg:grid-cols-[minmax(0,1fr)_220px] lg:gap-12">
      <article>
        <header className="border-b border-ink-200 pb-8">
          <nav aria-label="面包屑" className="text-sm text-ink-500">
            <Link href="/" className="hover:text-brand-700">
              首页
            </Link>
            <span className="mx-2" aria-hidden>
              /
            </span>
            <Link href={`/s/${article.sectionSlug}`} className="hover:text-brand-700">
              {article.sectionName}
            </Link>
          </nav>
          <h1 className="mt-4 font-serif text-3xl font-semibold leading-snug text-ink-900 sm:text-4xl">
            {article.title}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-500">
            <span className="font-medium text-ink-700">{article.authorName ?? '佚名'}</span>
            <time dateTime={article.publishedAt.toISOString()}>
              发布于 {formatDate(article.publishedAt)}
            </time>
            <time dateTime={article.revisedAt.toISOString()}>
              内容更新于 {formatDate(article.revisedAt)}
            </time>
            <span>第 {article.seq} 号修订</span>
          </div>
        </header>

        <div className="prose-zh py-8">
          <ArticleRenderer doc={article.content} />
        </div>

        <footer className="border-t border-ink-200 pt-6 text-sm leading-relaxed text-ink-500">
          <p>
            本文以{' '}
            <a
              href="https://creativecommons.org/licenses/by-sa/4.0/deed.zh-hans"
              rel="license noopener"
              target="_blank"
              className="text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-900"
            >
              CC BY-SA 4.0
            </a>{' '}
            协议发布：转载请署名并注明出处，演绎版本须以相同协议共享。
          </p>
          <p className="mt-2">
            <Link
              href={`/a/${article.slug}/history`}
              className="text-brand-700 hover:text-brand-900"
            >
              查看修订历史 →
            </Link>
          </p>
        </footer>
      </article>

      {toc.length > 0 ? (
        <aside className="hidden lg:block">
          <nav aria-label="目录" className="sticky top-10 border-l border-ink-200 pl-5 text-sm">
            <p className="font-medium text-ink-800">目录</p>
            <ul className="mt-3 flex flex-col gap-2">
              {toc.map((entry) => (
                <li
                  key={entry.id}
                  className={entry.level === 3 ? 'pl-3' : entry.level === 4 ? 'pl-6' : ''}
                >
                  <a
                    href={`#${entry.id}`}
                    className="text-ink-500 transition-colors hover:text-brand-700"
                  >
                    {entry.text}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
      ) : null}
    </div>
  );
}
