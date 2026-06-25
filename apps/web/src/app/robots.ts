// robots：放行公开内容，挡住后台/写作/账户/接口等非索引区；指向 sitemap。
import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site-url';

export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/write', '/account', '/notifications', '/api/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
