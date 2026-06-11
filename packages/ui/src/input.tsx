import type { ComponentProps } from 'react';
import { cn } from './cn';

export interface InputProps extends ComponentProps<'input'> {
  /** 错误态：红边 + aria-invalid（与字段错误文本配合）。 */
  invalid?: boolean;
}

export function Input({ className, invalid, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        'h-9 w-full rounded-sm border bg-paper-50 px-3 text-sm text-ink-900',
        'placeholder:text-ink-400',
        'focus-visible:outline-none focus-visible:ring-2',
        invalid
          ? 'border-accent-500 focus-visible:border-accent-500 focus-visible:ring-accent-200'
          : 'border-ink-200 focus-visible:border-brand-500 focus-visible:ring-brand-200',
        'disabled:cursor-not-allowed disabled:bg-paper-200 disabled:opacity-70',
        className,
      )}
      {...props}
    />
  );
}
