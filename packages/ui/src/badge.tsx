import type { ComponentProps } from 'react';
import { cn } from './cn';

export type BadgeVariant = 'default' | 'brand' | 'accent' | 'outline';

export interface BadgeProps extends ComponentProps<'span'> {
  variant?: BadgeVariant;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'border-transparent bg-paper-200 text-ink-700',
  brand: 'border-transparent bg-brand-100 text-brand-800',
  accent: 'border-transparent bg-accent-100 text-accent-800',
  outline: 'border-ink-300 text-ink-600',
};

export function Badge({ variant = 'default', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-medium leading-relaxed',
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
