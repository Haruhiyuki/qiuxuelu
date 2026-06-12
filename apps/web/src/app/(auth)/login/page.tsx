'use client';

import { Alert, Button, Input, Label } from '@harublog/ui';
import { KeyRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
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

  // 通行密钥条件式自动填充（Conditional UI）：支持的浏览器在聚焦邮箱框时
  // 于自动填充列表中直接列出本站通行密钥，选中即完成登录，无需点任何按钮。
  useEffect(() => {
    if (typeof window.PublicKeyCredential?.isConditionalMediationAvailable !== 'function') {
      return;
    }
    let cancelled = false;
    window.PublicKeyCredential.isConditionalMediationAvailable().then((available) => {
      if (!available || cancelled) {
        return;
      }
      void authClient.signIn.passkey({ autoFill: true }).then((res) => {
        if (!cancelled && res !== undefined && res.error === null) {
          router.push('/');
          router.refresh();
        }
      });
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handlePasskey() {
    setError(null);
    setPending(true);
    const res = await authClient.signIn.passkey();
    if (res?.error) {
      setError('通行密钥验证未完成，请重试或改用密码登录');
      setPending(false);
      return;
    }
    // 跳首页并刷新：让服务端组件（顶部导航等）重新读取会话
    router.push('/');
    router.refresh();
  }

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
            // webauthn 令牌让浏览器在此输入框的自动填充里列出通行密钥
            autoComplete="email webauthn"
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

      <div className="mt-4 flex items-center gap-3 text-ink-300 text-xs" aria-hidden>
        <span className="h-px flex-1 bg-ink-200" />
        或
        <span className="h-px flex-1 bg-ink-200" />
      </div>

      <Button
        type="button"
        variant="secondary"
        onClick={handlePasskey}
        disabled={pending}
        className="mt-4 w-full"
      >
        <KeyRound className="h-4 w-4" aria-hidden />
        使用通行密钥登录
      </Button>

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
