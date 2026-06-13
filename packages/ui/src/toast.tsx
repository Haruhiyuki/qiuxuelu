'use client';

// 轻量 Toast 系统：统一成功/失败/提示反馈，替代散落的 window.alert。Provider 挂根布局，组件内用 useToast。
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { cn } from './cn';

export type ToastVariant = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  variant: ToastVariant;
  message: string;
}

type ToastFn = (message: string, variant?: ToastVariant) => void;

const ToastContext = createContext<ToastFn | null>(null);

const VARIANT_CLASS: Record<ToastVariant, string> = {
  success: 'border-l-moss-600 bg-moss-50 text-moss-900',
  error: 'border-l-accent-600 bg-accent-50 text-accent-900',
  info: 'border-l-brand-600 bg-brand-50 text-brand-900',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const toast = useCallback<ToastFn>((message, variant = 'info') => {
    idRef.current += 1;
    const id = idRef.current;
    setItems((prev) => [...prev, { id, variant, message }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <section
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4"
        aria-label="通知提示"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              'toast-in pointer-events-auto w-full max-w-sm rounded-sm border-l-4 px-4 py-2.5 text-sm shadow-lg',
              VARIANT_CLASS[t.variant],
            )}
          >
            {t.message}
          </div>
        ))}
      </section>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastFn {
  const ctx = useContext(ToastContext);
  if (ctx === null) {
    throw new Error('useToast 必须在 <ToastProvider> 内使用');
  }
  return ctx;
}
