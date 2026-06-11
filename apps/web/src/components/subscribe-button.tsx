'use client';

// 板块订阅按钮：乐观切换，未登录引导登录。
import { useToast } from '@harublog/ui';
import { Bell, BellOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toggleSubscription } from '@/server/actions/subscriptions';

export function SubscribeButton({
  sectionId,
  initialSubscribed,
  loggedIn,
}: {
  sectionId: string;
  initialSubscribed: boolean;
  loggedIn: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [subscribed, setSubscribed] = useState(initialSubscribed);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (!loggedIn) {
      toast('请先登录', 'info');
      router.push('/login');
      return;
    }
    if (busy) {
      return;
    }
    setBusy(true);
    setSubscribed((v) => !v);
    const r = await toggleSubscription(sectionId);
    if (r.ok) {
      setSubscribed(r.data.subscribed);
      toast(r.data.subscribed ? '已订阅，新文章将邮件通知你' : '已退订', 'success');
    } else {
      setSubscribed(subscribed);
      toast(r.error, 'error');
    }
    setBusy(false);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={subscribed}
      className={`inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-sm transition-colors ${
        subscribed
          ? 'border-brand-300 bg-brand-50 text-brand-700'
          : 'border-ink-300 text-ink-700 hover:bg-paper-200'
      }`}
    >
      {subscribed ? (
        <BellOff className="h-4 w-4" aria-hidden />
      ) : (
        <Bell className="h-4 w-4" aria-hidden />
      )}
      {subscribed ? '已订阅' : '订阅板块'}
    </button>
  );
}
