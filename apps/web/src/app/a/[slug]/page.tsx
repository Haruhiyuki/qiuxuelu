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
import { MentionText } from '@/components/comments/mention-text';
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

  // 失锚批注没有可对齐的正文锚点：不进边注栏，在文末折叠展示（服务端渲染，无需 JS）
  const anchored = inlineComments.filter((c) => c.state !== 'orphaned');
  const orphaned = inlineComments.filter((c) => c.state === 'orphaned');

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

  // 无目录时不留左栏（空栏会让正文不对称偏右）；批注栏只在 xl+ 出现
  const gridCols =
    toc.length > 0
      ? 'lg:grid lg:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[200px_minmax(0,1fr)_280px]'
      : 'xl:grid xl:grid-cols-[minmax(0,1fr)_280px]';

  return (
    <div className={`mx-auto w-full max-w-7xl px-6 py-10 lg:gap-x-10 xl:gap-x-12 ${gridCols}`}>
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
      {/* 左栏：目录（lg+），吸顶随读；无目录时整栏不渲染 */}
      {toc.length > 0 ? (
        <aside className="hidden lg:block">
          <nav
            aria-label="目录"
            className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pr-1 text-sm"
          >
            <p className="font-medium text-ink-400 text-xs tracking-[0.3em]">目录</p>
            <TocNav items={toc} />
          </nav>
        </aside>
      ) : null}

      {/* 中栏：正文。内容整体收在与 .prose-zh 同宽的列里，标题/讨论与正文左缘对齐 */}
      <article className="mx-auto w-full min-w-0 max-w-[38em]">
        <header className="rise-in">
          <nav aria-label="面包屑" className="text-ink-500 text-sm">
            <Link href="/" className="transition-colors hover:text-brand-700">
              首页
            </Link>
            <span className="mx-2 text-ink-300" aria-hidden>
              /
            </span>
            <Link
              href={`/s/${article.sectionSlug}`}
              className="text-brand-700 transition-colors hover:text-brand-900"
            >
              {article.sectionName}
            </Link>
          </nav>
          <h1 className="mt-5 font-semibold font-serif text-3xl text-ink-900 leading-snug tracking-wide sm:text-4xl sm:leading-snug">
            {article.title}
          </h1>
          <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 text-ink-500 text-sm">
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 font-serif text-brand-800 text-xs"
              >
                {(article.authorName ?? '佚').charAt(0)}
              </span>
              {article.ownerId !== null ? (
                <Link
                  href={`/u/${article.ownerId}`}
                  className="font-medium text-ink-700 transition-colors hover:text-brand-700"
                >
                  {article.authorName ?? '佚名'}
                </Link>
              ) : (
                <span className="font-medium text-ink-700">{article.authorName ?? '佚名'}</span>
              )}
            </span>
            <span aria-hidden className="text-ink-300">
              ·
            </span>
            <time dateTime={article.publishedAt.toISOString()}>
              {formatDate(article.publishedAt)} 发布
            </time>
            <span aria-hidden className="text-ink-300">
              ·
            </span>
            <time dateTime={article.revisedAt.toISOString()}>
              {formatDate(article.revisedAt)} 更新
            </time>
            <span aria-hidden className="text-ink-300">
              ·
            </span>
            <Link
              href={`/a/${article.slug}/history`}
              className="transition-colors hover:text-brand-700"
              title="查看修订历史"
            >
              第 {article.seq} 号修订
            </Link>
            <span aria-hidden className="text-ink-300">
              ·
            </span>
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
          {/* 文武线：标题区与正文之间的书版分隔 */}
          <div aria-hidden className="rule-double mt-8" />
        </header>

        <div id="article-body" className="prose-zh py-10">
          <ArticleRenderer
            doc={content}
            codeHighlights={codeHighlights}
            mathRenderer={renderMath}
            imageMeta={imageMeta}
          />
          <CodeCopy />
        </div>

        {/* 卷末朱印：全文终了的视觉句点 */}
        <div aria-hidden className="flex items-center justify-center gap-4 pt-2">
          <span className="h-px w-12 bg-ink-200" />
          <span className="flex h-8 w-8 rotate-3 items-center justify-center rounded-xs bg-danger-fill font-serif text-on-fill text-sm shadow-paper">
            完
          </span>
          <span className="h-px w-12 bg-ink-200" />
        </div>

        <div className="flex justify-center py-6">
          <ReactionBar
            docId={article.docId}
            initialLikeCount={reactions.likeCount}
            initialDislikeCount={reactions.dislikeCount}
            initialMyVote={reactions.myVote}
            initialBookmarked={reactions.bookmarked}
            loggedIn={session !== null}
          />
        </div>

        {docTags.length > 0 ? (
          <div className="flex flex-wrap items-center justify-center gap-2 pb-6">
            {docTags.map((t) => (
              <Link
                key={t.name}
                // 指向同板块的标签筛选（标签在板块内做分类）；跨板块全局视图见 /t/<name>
                href={`/s/${article.sectionSlug}?tag=${encodeURIComponent(t.name)}`}
                className="rounded-full border border-ink-200 bg-paper-50 px-3 py-0.5 text-ink-600 text-sm transition-colors hover:border-brand-300 hover:text-brand-700"
              >
                #{t.name}
              </Link>
            ))}
          </div>
        ) : null}

        <footer className="rounded-md border border-ink-200 bg-paper-50 p-5 text-ink-500 text-sm leading-relaxed shadow-paper">
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
          <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
            <Link
              href={`/a/${article.slug}/history`}
              className="text-brand-700 transition-colors hover:text-brand-900"
            >
              查看修订历史 →
            </Link>
            {canCollabEdit ? (
              <Link
                href={`/a/${article.slug}/edit`}
                className="text-brand-700 transition-colors hover:text-brand-900"
              >
                协作编辑这篇文章 →
              </Link>
            ) : null}
            {canSuggest ? (
              <Link
                href={`/a/${article.slug}/suggest`}
                className="text-brand-700 transition-colors hover:text-brand-900"
              >
                提出编辑建议 →
              </Link>
            ) : null}
          </p>
        </footer>

        {/* 失锚批注：原文已改、无处可栖的批注收进折叠区（服务端渲染） */}
        {orphaned.length > 0 ? (
          <details className="mt-8 rounded-md border border-ink-200 border-dashed p-4 text-sm">
            <summary className="cursor-pointer text-ink-500 transition-colors hover:text-ink-700">
              原文已修改的历史批注（{orphaned.length}）
            </summary>
            <ul className="mt-4 flex flex-col gap-4">
              {orphaned.map((c) => (
                <li key={c.id} className="border-ink-100 border-l-2 pl-3">
                  <p className="text-ink-400 text-xs italic">「{c.quotedText.slice(0, 50)}」</p>
                  <p className="mt-1 whitespace-pre-wrap text-ink-700 leading-relaxed">
                    <MentionText text={c.text} />
                  </p>
                  <p className="mt-0.5 text-ink-400 text-xs">
                    {c.authorName} · {c.createdAtLabel}
                  </p>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <CommentSection docId={article.docId} sectionId={article.sectionId} />
      </article>

      {/* 右栏：行内批注边注栏（xl+ 对齐锚点段落；窄屏退化为点击高亮弹浮窗） */}
      <InlineComments docId={article.docId} canComment={session !== null} comments={anchored} />
    </div>
  );
}
