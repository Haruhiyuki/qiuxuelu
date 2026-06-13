// 管理后台统一页头：标题（可带计数）+ 说明 + 右侧操作槽。各管理子页一致使用，杜绝标题位置/字号漂移。
import type { ReactNode } from 'react';

export function AdminPageHeader({
  title,
  description,
  count,
  actions,
}: {
  title: string;
  /** 副标题/说明，接受富文本 */
  description?: ReactNode;
  /** 可选计数徽章（如待办条数），紧跟标题 */
  count?: number;
  /** 右侧操作区（按钮/筛选等） */
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-ink-200 border-b pb-5">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <h1 className="font-semibold font-serif text-2xl text-ink-900">{title}</h1>
          {count !== undefined ? (
            <span className="rounded-full bg-paper-200 px-2 py-0.5 text-ink-600 text-xs tabular-nums">
              {count}
            </span>
          ) : null}
        </div>
        {description !== undefined ? (
          <p className="mt-2 text-ink-500 text-sm leading-relaxed">{description}</p>
        ) : null}
      </div>
      {actions !== undefined ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
