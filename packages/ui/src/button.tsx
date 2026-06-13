import type { ComponentProps } from 'react';
import { cn } from './cn';
import { Spinner } from './spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 加载态：显示 spinner 并禁用，避免重复提交。 */
  loading?: boolean;
}

const baseClasses =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm font-medium ' +
  // 颜色/阴影平滑过渡 + 按下时轻微回弹（尊重 reduced-motion）
  'transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out ' +
  'motion-safe:active:scale-[0.97] ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ' +
  'disabled:pointer-events-none disabled:opacity-50';

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-fill text-on-fill hover:bg-fill-hover',
  secondary:
    'border border-ink-200 bg-paper-50 text-ink-800 hover:border-ink-300 hover:bg-paper-200',
  ghost: 'text-brand-700 hover:bg-brand-50',
  danger: 'bg-danger-fill text-on-fill hover:bg-danger-fill-hover focus-visible:outline-accent-600',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-9 px-4 text-sm',
};

export function Button({
  variant = 'primary',
  size = 'md',
  // 浏览器默认 type 是 submit，表单内极易误触提交；显式收紧为 button，调用方可透传覆盖
  type = 'button',
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(baseClasses, variantClasses[variant], sizeClasses[size], className)}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}
