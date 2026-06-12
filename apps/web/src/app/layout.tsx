import { SITE_DESCRIPTION, SITE_NAME } from '@harublog/config';
import { ToastProvider } from '@harublog/ui';
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
    // data-scroll-behavior：告知 Next 16 路由切换时绕过 CSS 平滑滚动，瞬时复位滚动条
    <html lang="zh-CN" data-scroll-behavior="smooth">
      <body className="flex min-h-svh flex-col antialiased">
        {/* 首帧前设好明暗 class，避免主题闪烁（FOUC）。内联同步执行，先于内容绘制。 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
        <ToastProvider>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </ToastProvider>
      </body>
    </html>
  );
}
