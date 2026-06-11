'use client';

import { Alert, Button, Input, Label } from '@harublog/ui';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { authClient } from '@/lib/auth-client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error: authError } = await authClient.requestPasswordReset({
      email: email.trim(),
      redirectTo: '/reset-password',
    });
    if (authError) {
      setError('发送失败，请稍后重试');
      setPending(false);
      return;
    }
    // 不泄露邮箱是否注册：无论是否存在都提示已发送
    setSent(true);
  }

  return (
    <div>
      <h1 className="font-serif text-2xl font-semibold text-ink-900">找回密码</h1>
      <p className="mt-2 text-ink-500 text-sm">填写注册邮箱，我们会发送重置链接。</p>

      {sent ? (
        <Alert variant="info" className="mt-8">
          如果该邮箱已注册，重置链接已发送，请查收邮件（含垃圾箱）。
        </Alert>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="mt-8 flex flex-col gap-5">
          {error !== null ? <Alert variant="danger">{error}</Alert> : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">邮箱</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? '发送中…' : '发送重置链接'}
          </Button>
        </form>
      )}

      <p className="mt-6 text-ink-500 text-sm">
        <Link href="/login" className="text-brand-700 hover:text-brand-900">
          ← 返回登录
        </Link>
      </p>
    </div>
  );
}
