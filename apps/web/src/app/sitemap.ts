// 动态站点地图：首页 + 全部已发布文章 + 透明度页。供搜索引擎遍历收录。
// 板块浏览已并入首页筛选（/?section=），不再单列板块 URL。
import { documents, getDb } from '@harublog/db';
import { desc, eq } from 'drizzle-orm';
import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site-url';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const docs = await getDb()
    .select({ slug: documents.slug, updatedAt: documents.updatedAt })
    .from(documents)
    .where(eq(documents.status, 'published'))
    .orderBy(desc(documents.updatedAt));

  return [
    { url: SITE_URL, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/transparency`, changeFrequency: 'monthly', priority: 0.3 },
    ...docs.map((d) => ({
      url: `${SITE_URL}/a/${d.slug}`,
      lastModified: d.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ];
}
