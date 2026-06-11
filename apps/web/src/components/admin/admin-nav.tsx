'use client';

// 管理后台横向导航条：跨子页快速切换（替代每页「返回管理后台」的低效跳转）。当前页高亮。
import { cn } from '@harublog/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface AdminNavItem {
  href: string;
  label: string;
}

export function AdminNav({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="管理后台导航"
      className="sticky top-0 z-10 border-ink-200 border-b bg-paper-50/90 backdrop-blur"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-1 px-6 py-2">
        {items.map((item) => {
          // /admin 仅在精确匹配时高亮；其余子页按前缀
          const active =
            item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'rounded-sm px-3 py-1.5 font-medium text-sm transition-colors',
                active ? 'bg-brand-100 text-brand-800' : 'text-ink-600 hover:bg-paper-200',
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
