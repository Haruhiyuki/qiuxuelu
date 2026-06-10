import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';

/* 剔除原生 title（tooltip 语义），避免与本组件的标题 prop 串义 */
export interface EmptyStateProps extends Omit<ComponentProps<'div'>, 'title'> {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 py-16 text-center',
        className,
      )}
      {...props}
    >
      {icon != null ? (
        <div className="mb-2 flex size-12 items-center justify-center rounded-md bg-paper-200 text-ink-400 [&>svg]:size-6">
          {icon}
        </div>
      ) : null}
      <p className="font-serif text-base font-semibold text-ink-800">{title}</p>
      {description != null ? (
        <p className="max-w-sm text-sm leading-relaxed text-ink-500">{description}</p>
      ) : null}
      {action != null ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
