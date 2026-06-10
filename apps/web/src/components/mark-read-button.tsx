'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { markAllNotificationsRead } from '@/server/actions/notification';

export function MarkReadButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function handleClick() {
    setPending(true);
    await markAllNotificationsRead();
    router.refresh();
    setPending(false);
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="text-sm text-brand-700 hover:text-brand-900 disabled:opacity-50"
    >
      {pending ? '处理中…' : '全部标为已读'}
    </button>
  );
}
