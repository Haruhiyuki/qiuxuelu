'use client';

// 目录滚动高亮（scroll-spy）：IntersectionObserver 跟踪当前可见章节并高亮对应目录项。
import type { TocEntry } from '@harublog/renderer';
import { useEffect, useState } from 'react';

export function TocNav({ items }: { items: TocEntry[] }) {
  const [active, setActive] = useState('');

  useEffect(() => {
    const headings = items
      .map((i) => document.getElementById(i.id))
      .filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) {
          // 取最靠上的可见章节
          const top = visible.reduce((a, b) =>
            a.boundingClientRect.top < b.boundingClientRect.top ? a : b,
          );
          setActive(top.target.id);
        }
      },
      // 命中区落在视口上 1/3：标题滚到偏上即视为「当前」
      { rootMargin: '0px 0px -66% 0px', threshold: 0 },
    );
    for (const h of headings) {
      observer.observe(h);
    }
    return () => observer.disconnect();
  }, [items]);

  return (
    <ul className="mt-4 flex flex-col border-ink-200 border-l">
      {items.map((entry) => (
        <li key={entry.id}>
          <a
            href={`#${entry.id}`}
            className={`-ml-px block border-l-2 py-1 leading-relaxed transition-colors hover:text-brand-700 ${
              entry.level === 3 ? 'pl-6' : entry.level === 4 ? 'pl-9' : 'pl-3'
            } ${
              active === entry.id
                ? 'border-accent-600 font-medium text-ink-900'
                : 'border-transparent text-ink-500'
            }`}
          >
            {entry.text}
          </a>
        </li>
      ))}
    </ul>
  );
}
