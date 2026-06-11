import { cn } from './cn';

export interface SpinnerProps {
  className?: string;
}

/** 轻量加载指示器（随字号缩放，currentColor 着色）。 */
export function Spinner({ className }: SpinnerProps) {
  return (
    <svg
      className={cn('animate-spin', className)}
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
