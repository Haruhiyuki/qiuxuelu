import { SITE_DESCRIPTION, SITE_NAME } from '@harublog/config';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: `${SITE_NAME}——可协作的求学经验之书`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
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
