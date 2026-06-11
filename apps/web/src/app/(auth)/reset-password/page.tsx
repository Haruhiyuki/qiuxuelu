'use client';

import { Alert, Button, Input, Label } from '@harublog/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { translateAuthError } from '@/lib/auth-errors';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get('token'));
    setReady(true);
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (next.length < 8) {
      setError('新密码至少 8 位');
      return;
    }
    if (next !== confirm) {
      setError('两次输入的新密码不一致');
      return;
    }
    if (token === null) {
      setError('重置链接无效或已过期，请重新申请');
      return;
    }
    setPending(true);
    setError(null);
    const { error: authError } = await authClient.resetPassword({ newPassword: next, token });
    if (authError) {
      setError(translateAuthError(authError.code));
      setPending(false);
      return;
    }
    setDone(true);
    setTimeout(() => router.push('/login'), 1500);
  }

  return (
    <div>
      <h1 className="font-serif text-2xl font-semibold text-ink-900">设置新密码</h1>
      <p className="mt-2 text-ink-500 text-sm">输入新密码以完成重置。</p>

      {done ? (
        <Alert variant="info" className="mt-8">
          密码已重置，正在跳转到登录…
        </Alert>
      ) : ready && token === null ? (
        <Alert variant="danger" className="mt-8">
          重置链接无效或缺少令牌，请{' '}
          <Link href="/forgot-password" className="underline">
            重新申请
          </Link>
          。
        </Alert>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="mt-8 flex flex-col gap-5">
          {error !== null ? <Alert variant="danger">{error}</Alert> : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new">新密码（至少 8 位）</Label>
            <Input
              id="new"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm">确认新密码</Label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? '提交中…' : '重置密码'}
          </Button>
        </form>
      )}
    </div>
  );
}
