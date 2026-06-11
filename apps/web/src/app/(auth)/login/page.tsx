'use client';

import { Alert, Button, Input, Label } from '@harublog/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { OAuthButtons } from '@/components/auth/oauth-buttons';
import { authClient } from '@/lib/auth-client';
import { translateAuthError } from '@/lib/auth-errors';

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!EMAIL_PATTERN.test(email)) {
      setError('请输入有效的邮箱地址');
      return;
    }
    if (password.length === 0) {
      setError('请输入密码');
      return;
    }

    setPending(true);
    const { error: authError } = await authClient.signIn.email({ email, password });
    if (authError) {
      setError(translateAuthError(authError.code));
      setPending(false);
      return;
    }
    // 跳首页并刷新：让服务端组件（顶部导航等）重新读取会话
    router.push('/');
    router.refresh();
  }

  return (
    <div>
      <h1 className="font-serif text-2xl font-semibold text-ink-900">登录</h1>
      <p className="mt-2 text-sm text-ink-500">欢迎回来，继续书写或批注。</p>

      <OAuthButtons />

      <form onSubmit={handleSubmit} noValidate className="mt-5 flex flex-col gap-5">
        {error !== null ? <Alert variant="danger">{error}</Alert> : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">邮箱</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">密码</Label>
            <Link href="/forgot-password" className="text-ink-500 text-xs hover:text-brand-700">
              忘记密码？
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <Button type="submit" disabled={pending} className="mt-2">
          {pending ? '登录中…' : '登录'}
        </Button>
      </form>

      <p className="mt-6 text-sm text-ink-500">
        还没有账号？{' '}
        <Link
          href="/register"
          className="text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-900"
        >
          注册
        </Link>
      </p>
    </div>
  );
}
