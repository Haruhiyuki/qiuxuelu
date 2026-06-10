import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** clsx 负责条件组合，tailwind-merge 负责去冲突——保证调用方传入的类能覆盖组件默认类。 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
