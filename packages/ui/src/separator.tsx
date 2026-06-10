import type { ComponentProps } from 'react';
import { cn } from './cn';

export interface SeparatorProps extends ComponentProps<'div'> {
  orientation?: 'horizontal' | 'vertical';
  /** 默认纯装饰（对辅助技术隐藏）；传 false 时输出 role="separator" 语义 */
  decorative?: boolean;
}

const orientationClasses = {
  horizontal: 'h-px w-full',
  vertical: 'h-full w-px',
} as const;

export function Separator({
  orientation = 'horizontal',
  decorative = true,
  className,
  ...props
}: SeparatorProps) {
  /* ARIA：separator 默认即 horizontal，仅 vertical 需显式标注 */
  const semanticProps = decorative
    ? ({ 'aria-hidden': true } as const)
    : ({
        role: 'separator',
        ...(orientation === 'vertical' ? { 'aria-orientation': 'vertical' as const } : {}),
      } as const);

  return (
    <div
      {...semanticProps}
      className={cn('shrink-0 bg-ink-200', orientationClasses[orientation], className)}
      {...props}
    />
  );
}
