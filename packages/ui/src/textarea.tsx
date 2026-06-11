import type { ComponentProps } from 'react';
import { cn } from './cn';

export interface TextareaProps extends ComponentProps<'textarea'> {
  /** 错误态：红边 + aria-invalid。 */
  invalid?: boolean;
}

export function Textarea({ className, invalid, ...props }: TextareaProps) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(
        'min-h-20 w-full rounded-sm border bg-paper-50 px-3 py-2 text-sm leading-relaxed text-ink-900',
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
