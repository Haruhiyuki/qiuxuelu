import type { ComponentProps } from 'react';
import { cn } from './cn';

export type SkeletonProps = ComponentProps<'div'>;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-sm bg-ink-100', className)}
      {...props}
    />
  );
}
