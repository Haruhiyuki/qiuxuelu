'use client';

// 移动端筛选抽屉：点「筛选」从右侧滑出，内含与桌面左栏相同的板块/标签筛选（服务端渲染传入 children）。
// 选中某筛选（URL 变化）即自动关闭。桌面端（lg+）隐藏触发按钮，直接用左栏。
import { SlidersHorizontal } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function HomeFilterDrawer({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const sp = useSearchParams();

  // 选完筛选（searchParams 变化）即关闭
  useEffect(() => {
    setOpen(false);
  }, [sp]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ink-200 px-3 py-1.5 text-ink-600 text-sm transition-colors hover:border-brand-300 hover:text-brand-700 lg:hidden"
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden />
        筛选
      </button>

      {open
        ? createPortal(
            <div
              className="fixed inset-0 z-50 lg:hidden"
              role="dialog"
              aria-modal="true"
              aria-label="筛选"
            >
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setOpen(false)}
                className="overlay-in absolute inset-0 bg-ink-900/40 backdrop-blur-[1px]"
              />
              <div className="drawer-in absolute inset-y-0 right-0 flex w-[18rem] max-w-[85vw] flex-col bg-paper-50 p-4 shadow-float">
                <div className="mb-3 flex shrink-0 items-center justify-between">
                  <span className="font-medium font-serif text-ink-800">筛选</span>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="关闭"
                    className="flex h-8 w-8 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-paper-200 hover:text-ink-800"
                  >
                    ✕
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
