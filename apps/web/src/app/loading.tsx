import { Skeleton } from '@harublog/ui';

// 路由级加载兜底：导航时显示骨架而非白屏/抖动。
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <Skeleton className="h-8 w-2/3" />
      <div className="mt-6 flex flex-col gap-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-10/12" />
        <Skeleton className="h-4 w-9/12" />
        <Skeleton className="h-4 w-8/12" />
      </div>
    </div>
  );
}
