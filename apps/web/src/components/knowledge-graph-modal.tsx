'use client';

// 知识图谱入口：正文顶部信息栏里的一枚按钮，点击在居中弹窗里专门展示图谱（不再塞在正文下方）。
// 弹窗 portal 到 body（避开祖先 backdrop-blur 的定位陷阱），Esc/遮罩/✕ 关闭，开启锁背景滚动。
import { Waypoints, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LayeredGraph } from '@/server/references';
import { KnowledgeGraph } from './knowledge-graph';

export function KnowledgeGraphButton({ initialGraph }: { initialGraph: LayeredGraph }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const neighbors = initialGraph.nodes.length - 1;

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
    closeRef.current?.focus();
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
        className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 px-2.5 py-0.5 text-ink-600 text-xs transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
        title={`查看本帖与 ${neighbors} 篇相关帖子的提及关系`}
      >
        <Waypoints className="h-3.5 w-3.5" aria-hidden />
        知识图谱
      </button>

      {open
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
            >
              <button
                type="button"
                aria-label="关闭知识图谱"
                onClick={() => setOpen(false)}
                className="overlay-in absolute inset-0 bg-ink-900/40 backdrop-blur-[1px]"
              />
              <div className="pop-in relative flex h-[min(82vh,760px)] w-[min(960px,94vw)] flex-col overflow-hidden rounded-lg border border-ink-200 bg-paper-50 shadow-float">
                <div className="flex items-center justify-between border-ink-200/70 border-b px-4 py-2.5">
                  <h2
                    id={titleId}
                    className="flex items-center gap-2 font-medium font-serif text-ink-800"
                  >
                    <Waypoints className="h-4 w-4 text-brand-600" aria-hidden />
                    知识图谱
                  </h2>
                  <button
                    ref={closeRef}
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="关闭"
                    className="flex h-8 w-8 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-paper-200 hover:text-ink-800"
                  >
                    <X className="h-5 w-5" aria-hidden />
                  </button>
                </div>
                <div className="min-h-0 flex-1">
                  <KnowledgeGraph initialGraph={initialGraph} />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
