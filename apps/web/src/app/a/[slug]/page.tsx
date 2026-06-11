import { SITE_NAME } from '@harublog/config';
import {
  commentAnchors,
  comments,
  documents,
  documentTags,
  getDb,
  media as mediaTable,
  publishedSnapshots,
  revisions,
  sections,
  tags as tagsTable,
  user as userTable,
} from '@harublog/db';
import { can } from '@harublog/domain';
import { extractText, validateDoc } from '@harublog/kernel';
import type { ImageMetaMap, TocEntry } from '@harublog/renderer';
import { ArticleRenderer, extractToc, mediaHashFromSrc } from '@harublog/renderer';
import { Badge } from '@harublog/ui';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Metadata } from 'next';
import { unstable_cache } from 'next/cache';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CodeCopy } from '@/components/code-copy';
import { CommentSection } from '@/components/comments/comment-section';
import { InlineComments, type InlineCommentView } from '@/components/comments/inline-comments';
import { ModerationBar } from '@/components/moderation-bar';
import { ReactionBar } from '@/components/reaction-bar';
import { ReadingProgress } from '@/components/reading-progress';
import { JsonLd } from '@/components/seo/json-ld';
import { TocNav } from '@/components/toc-nav';
import { formatDate, formatDateTime } from '@/lib/format';
import { highlightDoc } from '@/lib/highlight';
import { renderMath } from '@/lib/math';
import { getSession } from '@/lib/session';
import { SITE_URL } from '@/lib/site-url';
import { loadActor } from '@/server/actors';
import { getReactionState } from '@/server/reactions';

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
      sectionId: documents.sectionId,
      ownerId: documents.ownerId,
      editPolicy: documents.editPolicy,
      featured: documents.featured,
      slug: documents.slug,
      title: documents.title,
      summary: documents.summary,
      revisionId: publishedSnapshots.revisionId,
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

/**
 * 已发布内容按 revisionId 缓存：修订不可变 → 内容永久可缓存，无需 revalidate（天然无失锚/无脏读）。
 * 重新发布会指向新 revisionId，页面据元数据查到新 id 即自然命中新缓存，旧缓存闲置待淘汰。
 */
const loadPublishedContent = (revisionId: string) =>
  unstable_cache(
    async () => {
      const rows = await getDb()
        .select({ content: publishedSnapshots.content })
        .from(publishedSnapshots)
        .where(eq(publishedSnapshots.revisionId, revisionId))
        .limit(1);
      return rows[0]?.content ?? null;
    },
    ['published-content', revisionId],
    { tags: [`revision:${revisionId}`] },
  )();

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
    // notFound() 在 Next 16 会软返回 200（框架限制）；至少标 noindex，避免「不存在」页被搜索引擎收录
    return { title: '文章不存在', robots: { index: false } };
  }
  const content = await loadPublishedContent(article.revisionId);
  const description = buildDescription(article.summary, content);
  return {
    title: article.title,
    description,
    openGraph: {
      title: article.title,
      description,
      type: 'article',
      url: `${SITE_URL}/a/${article.slug}`,
      publishedTime: article.publishedAt.toISOString(),
      modifiedTime: article.revisedAt.toISOString(),
    },
    twitter: { card: 'summary', title: article.title, description },
  };
}

export default async function ArticlePage({ params }: ArticlePageProps) {
  const { slug } = await params;
  const article = await loadArticle(slug);
  if (!article) {
    notFound();
  }

  // 已发布正文按 revisionId 缓存读取（不可变）
  const content = await loadPublishedContent(article.revisionId);

  // 目录、阅读时长、代码高亮、图片尺寸均从已校验文档派生；校验失败时正文交给 ArticleRenderer 的容错占位
  let toc: TocEntry[] = [];
  let readingMinutes = 1;
  let codeHighlights: Awaited<ReturnType<typeof highlightDoc>> | undefined;
  const imageHashes: string[] = [];
  try {
    const validated = validateDoc(content);
    toc = extractToc(validated);
    // 阅读时长：中文按字符计（约 400 字/分钟），至少 1 分钟
    readingMinutes = Math.max(1, Math.round([...extractText(validated)].length / 400));
    // 高亮按 revisionId 缓存（内容不可变 → 高亮结果永久可缓存，省去每次重算）
    codeHighlights = await highlightDoc(validated, article.revisionId);
    for (const node of validated.content) {
      if (node.type === 'figure') {
        const h = mediaHashFromSrc(node.attrs.src);
        if (h !== null) {
          imageHashes.push(h);
        }
      }
    }
  } catch {
    toc = [];
  }

  // 图片固有尺寸（防布局抖动 + srcset 不放大）：从 media 表查
  let imageMeta: ImageMetaMap | undefined;
  if (imageHashes.length > 0) {
    const metaRows = await getDb()
      .select({ hash: mediaTable.hash, width: mediaTable.width, height: mediaTable.height })
      .from(mediaTable)
      .where(inArray(mediaTable.hash, imageHashes));
    imageMeta = new Map(
      metaRows
        .filter((r) => r.width !== null && r.height !== null)
        .map((r) => [r.hash, { width: r.width as number, height: r.height as number }]),
    );
  }

  // 行内批注（kind='inline'，含锚点状态），与文章正文同页展示
  const db = getDb();
  const session = await getSession();

  // 协作入口（非作者）+ 治理控件（板块管理员+，含作者本人若有职务）
  let canCollabEdit = false;
  let canSuggest = false;
  let canFeature = false;
  let canProtect = false;
  if (session) {
    const actor = await loadActor(session.user.id);
    if (actor !== null) {
      if (session.user.id !== article.ownerId) {
        canCollabEdit = can(actor, 'doc.edit_direct', {
          sectionId: article.sectionId,
          doc: {
            id: article.docId,
            ownerId: article.ownerId ?? '',
            editPolicy: article.editPolicy as 'suggest_only' | 'open' | 'semi' | 'locked',
            status: 'published',
          },
        }).allow;
        canSuggest = can(actor, 'suggestion.create', { sectionId: article.sectionId }).allow;
      }
      canFeature = can(actor, 'doc.feature', { sectionId: article.sectionId }).allow;
      canProtect = can(actor, 'doc.protect', {
        sectionId: article.sectionId,
        doc: {
          id: article.docId,
          ownerId: article.ownerId ?? '',
          editPolicy: article.editPolicy as 'suggest_only' | 'open' | 'semi' | 'locked',
          status: 'published',
        },
      }).allow;
    }
  }
  const inlineRows = await db
    .select({
      id: comments.id,
      blockId: commentAnchors.blockId,
      quotedText: commentAnchors.quotedText,
      startOffset: commentAnchors.startOffset,
      endOffset: commentAnchors.endOffset,
      state: commentAnchors.state,
      body: comments.body,
      createdAt: comments.createdAt,
      authorName: userTable.name,
    })
    .from(comments)
    .innerJoin(commentAnchors, eq(commentAnchors.commentId, comments.id))
    .leftJoin(userTable, eq(userTable.id, comments.authorId))
    .where(
      and(
        eq(comments.documentId, article.docId),
        eq(comments.kind, 'inline'),
        eq(comments.status, 'visible'),
      ),
    )
    .orderBy(asc(comments.createdAt));
  const inlineComments: InlineCommentView[] = inlineRows.map((r) => ({
    id: r.id,
    blockId: r.blockId,
    quotedText: r.quotedText,
    startOffset: r.startOffset ?? 0,
    endOffset: r.endOffset ?? 0,
    text:
      typeof r.body === 'object' && r.body !== null && 'text' in r.body
        ? String((r.body as { text: unknown }).text)
        : '',
    authorName: r.authorName ?? '佚名',
    state: r.state as InlineCommentView['state'],
    createdAtLabel: formatDateTime(r.createdAt),
  }));

  const docTags = await db
    .select({ name: tagsTable.name })
    .from(documentTags)
    .innerJoin(tagsTable, eq(tagsTable.id, documentTags.tagId))
    .where(eq(documentTags.documentId, article.docId));

  const reactions = await getReactionState(db, article.docId, session?.user.id ?? null);

  const articleUrl = `${SITE_URL}/a/${article.slug}`;
  const description = buildDescription(article.summary, content);
  const authorLd =
    article.ownerId !== null
      ? {
          '@type': 'Person',
          name: article.authorName ?? '佚名',
          url: `${SITE_URL}/u/${article.ownerId}`,
        }
      : { '@type': 'Person', name: article.authorName ?? '佚名' };

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10 lg:grid lg:grid-cols-[minmax(0,1fr)_220px] lg:gap-12">
      <ReadingProgress />
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: article.title,
          ...(description.length > 0 ? { description } : {}),
          datePublished: article.publishedAt.toISOString(),
          dateModified: article.revisedAt.toISOString(),
          author: authorLd,
          publisher: { '@type': 'Organization', name: SITE_NAME },
          mainEntityOfPage: articleUrl,
          inLanguage: 'zh-CN',
          license: 'https://creativecommons.org/licenses/by-sa/4.0/',
        }}
      />
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: '首页', item: SITE_URL },
            {
              '@type': 'ListItem',
              position: 2,
              name: article.sectionName,
              item: `${SITE_URL}/s/${article.sectionSlug}`,
            },
            { '@type': 'ListItem', position: 3, name: article.title, item: articleUrl },
          ],
        }}
      />
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
            {article.ownerId !== null ? (
              <Link
                href={`/u/${article.ownerId}`}
                className="font-medium text-ink-700 hover:text-brand-700"
              >
                {article.authorName ?? '佚名'}
              </Link>
            ) : (
              <span className="font-medium text-ink-700">{article.authorName ?? '佚名'}</span>
            )}
            <time dateTime={article.publishedAt.toISOString()}>
              发布于 {formatDate(article.publishedAt)}
            </time>
            <time dateTime={article.revisedAt.toISOString()}>
              内容更新于 {formatDate(article.revisedAt)}
            </time>
            <span>第 {article.seq} 号修订</span>
            <span>约 {readingMinutes} 分钟</span>
            {article.featured ? <Badge variant="brand">精选</Badge> : null}
          </div>
          {canFeature || canProtect ? (
            <ModerationBar
              docId={article.docId}
              featured={article.featured}
              editPolicy={article.editPolicy}
              canFeature={canFeature}
              canProtect={canProtect}
            />
          ) : null}
        </header>

        <div className="prose-zh py-8">
          <ArticleRenderer
            doc={content}
            codeHighlights={codeHighlights}
            mathRenderer={renderMath}
            imageMeta={imageMeta}
          />
          <CodeCopy />
        </div>

        <div className="border-ink-200 border-t py-6">
          <ReactionBar
            docId={article.docId}
            initialLikeCount={reactions.likeCount}
            initialLiked={reactions.liked}
            initialBookmarked={reactions.bookmarked}
            loggedIn={session !== null}
          />
        </div>

        {docTags.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 pb-6">
            {docTags.map((t) => (
              <Link
                key={t.name}
                href={`/t/${encodeURIComponent(t.name)}`}
                className="rounded-sm bg-paper-200 px-2 py-0.5 text-ink-600 text-sm hover:text-brand-700"
              >
                #{t.name}
              </Link>
            ))}
          </div>
        ) : null}

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
          <p className="mt-2 flex flex-wrap gap-4">
            <Link
              href={`/a/${article.slug}/history`}
              className="text-brand-700 hover:text-brand-900"
            >
              查看修订历史 →
            </Link>
            {canCollabEdit ? (
              <Link
                href={`/a/${article.slug}/edit`}
                className="text-brand-700 hover:text-brand-900"
              >
                协作编辑这篇文章 →
              </Link>
            ) : null}
            {canSuggest ? (
              <Link
                href={`/a/${article.slug}/suggest`}
                className="text-brand-700 hover:text-brand-900"
              >
                提出编辑建议 →
              </Link>
            ) : null}
          </p>
        </footer>

        <InlineComments
          docId={article.docId}
          canComment={session !== null}
          comments={inlineComments}
        />

        <CommentSection docId={article.docId} sectionId={article.sectionId} />
      </article>

      {toc.length > 0 ? (
        <aside className="hidden lg:block">
          <nav aria-label="目录" className="sticky top-10 border-l border-ink-200 pl-5 text-sm">
            <p className="font-medium text-ink-800">目录</p>
            <TocNav items={toc} />
          </nav>
        </aside>
      ) : null}
    </div>
  );
}
