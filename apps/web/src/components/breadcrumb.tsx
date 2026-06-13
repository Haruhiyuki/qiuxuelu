import Link from 'next/link';

export interface Crumb {
  label: string;
  href?: string;
}

/** 面包屑导航：最后一项为当前页（不可点）。 */
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav
      aria-label="面包屑"
      className="mb-4 flex flex-wrap items-center gap-1.5 text-ink-500 text-sm"
    >
      {items.map((c, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={`${c.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 ? (
              <span aria-hidden className="text-ink-300">
                /
              </span>
            ) : null}
            {c.href && !isLast ? (
              <Link
                href={c.href}
                title={c.label}
                // 标题等长标签可能很长：限宽 + 省略号截断（min-w-0 让 flex 子项可收缩，max-width 才生效），
                // title 保留完整文本（悬停/无障碍可见）
                className="block min-w-0 max-w-[min(52vw,28rem)] truncate transition-colors hover:text-brand-700"
              >
                {c.label}
              </Link>
            ) : (
              <span
                title={c.label}
                className={`block min-w-0 max-w-[min(52vw,28rem)] truncate ${
                  isLast ? 'text-ink-700' : ''
                }`}
              >
                {c.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
