'use client';

// 聚焦写作器（/write/new、/write/[docId]）是全屏编辑界面、自带顶部操作条。
// 全局站点页头也是 sticky top-0，与编辑器自己的顶栏相互叠放/遮挡，导致移动端工具栏（sticky top-14）
// 被算错偏移、置顶失效。这里在这些路由隐藏全局页头，让编辑器顶栏成为唯一吸顶条。
// 注意：/write（草稿箱列表）是普通页面，保留页头——只隐藏 /write/ 下的具体编辑路由。
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export function ChromeGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname.startsWith('/write/')) {
    return null;
  }
  return <>{children}</>;
}
