import { SITE_DESCRIPTION, SITE_NAME } from '@harublog/config';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { SITE_URL } from '@/lib/site-url';
import './globals.css';

export const metadata: Metadata = {
  // 相对 OG/twitter 图与链接据此解析为绝对地址
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME}——可协作的求学经验之书`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  // RSS 订阅源自动发现
  alternates: { types: { 'application/rss+xml': `${SITE_URL}/feed.xml` } },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="flex min-h-svh flex-col antialiased">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
