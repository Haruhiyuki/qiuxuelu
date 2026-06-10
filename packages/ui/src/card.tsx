import type { ComponentProps } from 'react';
import { cn } from './cn';

export type CardProps = ComponentProps<'div'>;

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn('rounded-md border border-ink-200 bg-paper-50 text-ink-900', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1.5 p-5', className)} {...props} />;
}

/* 用 div 而非 h3：卡片在页面中的标题层级由调用方语境决定，组件不预设文档大纲 */
export function CardTitle({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('font-serif text-lg font-semibold leading-snug text-ink-900', className)}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('p-5 pt-0', className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex items-center gap-3 p-5 pt-0', className)} {...props} />;
}
