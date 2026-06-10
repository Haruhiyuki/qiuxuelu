import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-md flex-col px-6 py-16">{children}</div>;
}
