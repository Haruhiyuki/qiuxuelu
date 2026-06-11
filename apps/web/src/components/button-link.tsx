import { cn } from '@harublog/ui';
import Link from 'next/link';
import type { ComponentProps } from 'react';

type ButtonLinkVariant = 'primary' | 'secondary' | 'ghost';
type ButtonLinkSize = 'sm' | 'md';

export interface ButtonLinkProps extends ComponentProps<typeof Link> {
  variant?: ButtonLinkVariant;
  size?: ButtonLinkSize;
}

/*
 * 与 @harublog/ui Button 同款式的导航链接。
 * 单独实现而非把 <button> 嵌进 <a>：交互元素互相嵌套是非法 HTML；
 * 样式与 ui/button.tsx 保持手工同步（ui 包不归本 app 所有，不能改它导出常量）。
 */
const baseClasses =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm font-medium transition-colors ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

const variantClasses: Record<ButtonLinkVariant, string> = {
  primary: 'bg-fill text-on-fill hover:bg-fill-hover',
  secondary:
    'border border-ink-200 bg-paper-50 text-ink-800 hover:border-ink-300 hover:bg-paper-200',
  ghost: 'text-brand-700 hover:bg-brand-50',
};

const sizeClasses: Record<ButtonLinkSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-9 px-4 text-sm',
};

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      className={cn(baseClasses, variantClasses[variant], sizeClasses[size], className)}
      {...props}
    />
  );
}
