'use client';

// 文章顶部「协作」入口：点击弹窗列出三种协作方式（修订 / 修订申请 / 编辑建议，ADR-0010）。
// 权限不够的功能标灰 + 显示原因；可用的点击进入对应界面。弹窗 portal 到 body，Esc/遮罩/✕ 关闭。
import { ArrowRight, Lock, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface CollabFn {
  key: string;
  title: string;
  desc: string;
  /** 可用时的进入地址；不可用 / 占位为 null */
  href: string | null;
  allowed: boolean;
  /** 不可用时的原因（标灰展示） */
  reason: string;
}

export function CollaborationModal({ functions }: { functions: CollabFn[] }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);

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
        title="参与协作：修订 / 修订申请 / 编辑建议"
      >
        <Users className="h-3.5 w-3.5" aria-hidden />
        协作
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
                aria-label="关闭"
                onClick={() => setOpen(false)}
                className="overlay-in absolute inset-0 bg-ink-900/40 backdrop-blur-[1px]"
              />
              <div className="pop-in relative w-[min(30rem,94vw)] overflow-hidden rounded-lg border border-ink-200 bg-paper-50 shadow-float">
                <div className="flex items-center justify-between border-ink-200/70 border-b px-4 py-2.5">
                  <h2
                    id={titleId}
                    className="flex items-center gap-2 font-medium font-serif text-ink-800"
                  >
                    <Users className="h-4 w-4 text-brand-600" aria-hidden />
                    参与协作
                  </h2>
                  <button
                    ref={closeRef}
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="关闭"
                    className="flex h-8 w-8 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-paper-200 hover:text-ink-800"
                  >
                    ✕
                  </button>
                </div>

                <ul className="flex flex-col gap-2 p-4">
                  {functions.map((f) =>
                    f.allowed && f.href !== null ? (
                      <li key={f.key}>
                        <Link
                          href={f.href}
                          onClick={() => setOpen(false)}
                          className="group flex items-start gap-3 rounded-md border border-ink-200 bg-paper-100 p-3 transition-colors hover:border-brand-300 hover:bg-brand-50"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-ink-800">{f.title}</p>
                            <p className="mt-0.5 text-ink-500 text-sm leading-relaxed">{f.desc}</p>
                          </div>
                          <ArrowRight
                            className="mt-1 h-4 w-4 shrink-0 text-ink-300 transition-colors group-hover:text-brand-600"
                            aria-hidden
                          />
                        </Link>
                      </li>
                    ) : (
                      <li
                        key={f.key}
                        className="flex items-start gap-3 rounded-md border border-ink-200/60 border-dashed p-3 opacity-70"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-ink-500">{f.title}</p>
                          <p className="mt-0.5 text-ink-400 text-sm leading-relaxed">{f.desc}</p>
                          <p className="mt-1 flex items-center gap-1 text-ink-400 text-xs">
                            <Lock className="h-3 w-3" aria-hidden />
                            {f.reason}
                          </p>
                        </div>
                      </li>
                    ),
                  )}
                </ul>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
