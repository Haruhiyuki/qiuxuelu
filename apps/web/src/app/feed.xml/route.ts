// RSS 2.0 订阅源：最新已发布文章。博客刚需的内容分发出口（阅读器订阅）。
import { SITE_DESCRIPTION, SITE_NAME } from '@harublog/config';
import { documents, getDb, publishedSnapshots, user as userTable } from '@harublog/db';
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

export async function GET(): Promise<Response> {
  const db = getDb();
  const rows = await db
    .select({
      slug: documents.slug,
      title: documents.title,
      summary: documents.summary,
      publishedAt: publishedSnapshots.publishedAt,
      authorName: userTable.name,
    })
    .from(documents)
    .innerJoin(publishedSnapshots, eq(publishedSnapshots.documentId, documents.id))
    .leftJoin(userTable, eq(userTable.id, documents.ownerId))
    .where(eq(documents.status, 'published'))
    .orderBy(desc(publishedSnapshots.publishedAt))
    .limit(30);

  const items = rows
    .map((r) => {
      const link = `${SITE_URL}/a/${r.slug}`;
      return `    <item>
      <title>${esc(r.title)}</title>
      <link>${esc(link)}</link>
      <guid isPermaLink="true">${esc(link)}</guid>
      <pubDate>${r.publishedAt.toUTCString()}</pubDate>
      <author>${esc(r.authorName ?? '佚名')}</author>
      <description>${esc(r.summary ?? '')}</description>
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${esc(SITE_NAME)}</title>
    <link>${esc(SITE_URL)}</link>
    <description>${esc(SITE_DESCRIPTION)}</description>
    <language>zh-CN</language>
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
