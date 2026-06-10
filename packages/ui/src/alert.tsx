import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';

export type AlertVariant = 'info' | 'warn' | 'danger';

export interface AlertProps extends Omit<ComponentProps<'div'>, 'title'> {
  variant?: AlertVariant;
  title?: ReactNode;
}

const variantClasses: Record<AlertVariant, string> = {
  info: 'border-l-brand-600 bg-brand-50 text-brand-900',
  warn: 'border-l-ochre-600 bg-ochre-50 text-ochre-900',
  danger: 'border-l-accent-600 bg-accent-50 text-accent-900',
};

export function Alert({ variant = 'info', title, className, children, ...props }: AlertProps) {
  return (
    <div
      role="alert"
      className={cn(
        'rounded-r-sm border-l-3 px-4 py-3 text-sm leading-relaxed',
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      {title != null ? <p className="mb-1 font-medium">{title}</p> : null}
      {children}
    </div>
  );
}
