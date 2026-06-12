'use client';

// 主导航链接：按路径前缀点亮当前态（服务端 header 拿不到 pathname，故拆成客户端小组件）。
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export function NavLink({
  href,
  match,
  children,
}: {
  href: string;
  /** 命中该前缀即视为当前页；缺省用 href 本身（去掉 hash） */
  match?: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const prefix = match ?? href.split('#')[0];
  const active = prefix !== '' && (pathname === prefix || pathname.startsWith(`${prefix}/`));

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`relative py-1 transition-colors hover:text-brand-700 ${
        active
          ? 'font-medium text-ink-900 after:absolute after:inset-x-0 after:-bottom-[1px] after:h-[2px] after:bg-accent-600'
          : 'text-ink-600'
      }`}
    >
      {children}
    </Link>
  );
}
