import type { ComponentProps } from 'react';
import { cn } from './cn';

export type TextareaProps = ComponentProps<'textarea'>;

export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        'min-h-20 w-full rounded-sm border border-ink-200 bg-paper-50 px-3 py-2 text-sm leading-relaxed text-ink-900',
        'placeholder:text-ink-400',
        'focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200',
        'disabled:cursor-not-allowed disabled:bg-paper-200 disabled:opacity-70',
        className,
      )}
      {...props}
    />
  );
}
