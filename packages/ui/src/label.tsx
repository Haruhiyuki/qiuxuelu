import type { ComponentProps } from 'react';
import { cn } from './cn';

export type LabelProps = ComponentProps<'label'>;

export function Label({ className, ...props }: LabelProps) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: 通用封装，控件关联由调用方经 htmlFor 或嵌套控件提供
    <label className={cn('text-sm font-medium text-ink-700 select-none', className)} {...props} />
  );
}
