// RSS 2.0 订阅源：最新已发布文章。博客刚需的内容分发出口（阅读器订阅）。
// 规范要点：atom:self 自指链接、dc:creator 作者名（RSS2 的 <author> 须为邮箱，故改用 Dublin Core）、
// lastBuildDate；无摘要时回退取正文文本片段，避免条目描述空白。
import { SITE_DESCRIPTION, SITE_NAME } from '@harublog/config';
import { documents, getDb, publishedSnapshots, user as userTable } from '@harublog/db';
import { extractText, validateDoc } from '@harublog/kernel';
import { desc, eq } from 'drizzle-orm';
import { SITE_URL } from '@/lib/site-url';

export const dynamic = 'force-dynamic';

function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** 摘要优先；缺失时从正文取纯文本片段（容错坏数据），仍为空则返回空串。 */
function itemDescription(summary: string | null, content: unknown): string {
  if (summary !== null && summary.trim().length > 0) {
    return summary;
  }
  try {
    const text = extractText(validateDoc(content)).replaceAll('\n', ' ').trim();
    return text.slice(0, 200);
  } catch {
    return '';
  }
}

export async function GET(): Promise<Response> {
  const db = getDb();
  const rows = await db
    .select({
      slug: documents.slug,
      title: documents.title,
      summary: documents.summary,
      content: publishedSnapshots.content,
      publishedAt: publishedSnapshots.publishedAt,
      authorName: userTable.name,
    })
    .from(documents)
    .innerJoin(publishedSnapshots, eq(publishedSnapshots.documentId, documents.id))
    .leftJoin(userTable, eq(userTable.id, documents.ownerId))
    .where(eq(documents.status, 'published'))
    .orderBy(desc(publishedSnapshots.publishedAt))
    .limit(30);

  const feedUrl = `${SITE_URL}/feed.xml`;
  const lastBuild = rows[0]?.publishedAt ?? new Date();

  const items = rows
    .map((r) => {
      const link = `${SITE_URL}/a/${r.slug}`;
      return `    <item>
      <title>${esc(r.title)}</title>
      <link>${esc(link)}</link>
      <guid isPermaLink="true">${esc(link)}</guid>
      <pubDate>${r.publishedAt.toUTCString()}</pubDate>
      <dc:creator>${esc(r.authorName ?? '佚名')}</dc:creator>
      <description>${esc(itemDescription(r.summary, r.content))}</description>
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${esc(SITE_NAME)}</title>
    <link>${esc(SITE_URL)}</link>
    <atom:link href="${esc(feedUrl)}" rel="self" type="application/rss+xml" />
    <description>${esc(SITE_DESCRIPTION)}</description>
    <language>zh-CN</language>
    <lastBuildDate>${lastBuild.toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=900',
    },
  });
}
