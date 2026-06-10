import type { ComponentProps } from 'react';
import { cn } from './cn';

export type InputProps = ComponentProps<'input'>;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        'h-9 w-full rounded-sm border border-ink-200 bg-paper-50 px-3 text-sm text-ink-900',
        'placeholder:text-ink-400',
        'focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200',
        'disabled:cursor-not-allowed disabled:bg-paper-200 disabled:opacity-70',
        className,
      )}
      {...props}
    />
  );
}
