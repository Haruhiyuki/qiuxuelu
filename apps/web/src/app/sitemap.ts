// 动态站点地图：首页 + 板块 + 全部已发布文章 + 透明度页。供搜索引擎遍历收录。
import { documents, getDb, sections } from '@harublog/db';
import { desc, eq } from 'drizzle-orm';
import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site-url';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const db = getDb();
  const [docs, secs] = await Promise.all([
    db
      .select({ slug: documents.slug, updatedAt: documents.updatedAt })
      .from(documents)
      .where(eq(documents.status, 'published'))
      .orderBy(desc(documents.updatedAt)),
    db.select({ slug: sections.slug }).from(sections),
  ]);

  return [
    { url: SITE_URL, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/transparency`, changeFrequency: 'monthly', priority: 0.3 },
    ...secs.map((s) => ({
      url: `${SITE_URL}/s/${s.slug}`,
      changeFrequency: 'daily' as const,
      priority: 0.6,
    })),
    ...docs.map((d) => ({
      url: `${SITE_URL}/a/${d.slug}`,
      lastModified: d.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ];
}
