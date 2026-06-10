'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      className="text-sm text-ink-500 transition-colors hover:text-ink-700 disabled:opacity-50"
      onClick={async () => {
        setPending(true);
        await authClient.signOut();
        // 刷新让服务端组件（顶部导航）重新读取会话
        router.refresh();
        setPending(false);
      }}
    >
      退出
    </button>
  );
}
