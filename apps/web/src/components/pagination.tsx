import Link from 'next/link';

export interface PaginationProps {
  page: number;
  hasNext: boolean;
  basePath: string;
  /** 额外保留的查询参数（如搜索词 q）。 */
  params?: Record<string, string>;
}

/** 极简上一页/下一页分页（offset 翻页）；hasNext 由「多取一条」判定。 */
export function Pagination({ page, hasNext, basePath, params }: PaginationProps) {
  const href = (p: number) => {
    const sp = new URLSearchParams({ ...params, page: String(p) });
    return `${basePath}?${sp.toString()}`;
  };
  if (page <= 1 && !hasNext) {
    return null;
  }
  return (
    <nav aria-label="分页" className="mt-6 flex items-center justify-between text-sm">
      {page > 1 ? (
        <Link href={href(page - 1)} className="text-brand-700 hover:text-brand-900">
          ← 上一页
        </Link>
      ) : (
        <span className="text-ink-300">← 上一页</span>
      )}
      <span className="text-ink-400">第 {page} 页</span>
      {hasNext ? (
        <Link href={href(page + 1)} className="text-brand-700 hover:text-brand-900">
          下一页 →
        </Link>
      ) : (
        <span className="text-ink-300">下一页 →</span>
      )}
    </nav>
  );
}
