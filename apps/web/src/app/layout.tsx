import { SITE_DESCRIPTION, SITE_NAME } from '@harublog/config';
import { ToastProvider } from '@harublog/ui';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { ChromeGate } from '@/components/chrome-gate';
import { SearchCommand } from '@/components/search/search-command';
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

// 移动端视口：viewport-fit=cover 开启安全区（刘海屏让位），themeColor 让地址栏随明暗着色（呼应 paper-100）
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf8f3' },
    { media: '(prefers-color-scheme: dark)', color: '#191b1d' },
  ],
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
        {/* 跳到主内容：键盘用户首个可聚焦项，越过导航直达正文（WCAG 2.4.1） */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-md focus:border focus:border-ink-200 focus:bg-paper-50 focus:px-4 focus:py-2 focus:text-ink-900 focus:shadow-float"
        >
          跳到主内容
        </a>
        <ToastProvider>
          {/* 聚焦写作器（/write/...）隐藏全局页头，避免与编辑器自带顶栏双层吸顶相互遮挡；
              ⌘K 速搜面板随页头一起挂载（写作器内不挂，专注编辑） */}
          <ChromeGate>
            <SiteHeader />
            <SearchCommand />
          </ChromeGate>
          {/* tabIndex=-1：点击跳转链接后可把焦点落到正文（非进入 Tab 序） */}
          <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
            {children}
          </main>
          <SiteFooter />
        </ToastProvider>
      </body>
    </html>
  );
}
