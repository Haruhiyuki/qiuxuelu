'use client';

// 页面级错误边界：捕获渲染期异常，给中文兜底而非白屏；reset 可原地重试。
import { Button } from '@harublog/ui';
import { useEffect } from 'react';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 交给浏览器控制台 / 监控；不向用户暴露堆栈
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center px-6 py-24 text-center">
      <h1 className="font-semibold font-serif text-2xl text-ink-900">页面出错了</h1>
      <p className="mt-3 text-ink-500 text-sm leading-relaxed">
        抱歉，这个页面遇到了一点问题。可以重试，或稍后再来。
      </p>
      {error.digest ? <p className="mt-2 text-ink-400 text-xs">错误编号：{error.digest}</p> : null}
      <div className="mt-8">
        <Button onClick={reset}>重试</Button>
      </div>
    </div>
  );
}
