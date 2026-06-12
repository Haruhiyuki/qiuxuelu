'use client';

// 两步验证页：密码校验通过但账号开了 2FA 时，由 auth-client 的 onTwoFactorRedirect 引导至此。
// 支持 TOTP 动态码与备用恢复码两种方式；「信任此设备」用 better-auth 的 trustDevice（60 天免码）。
import { Alert, Button, Input, Label } from '@harublog/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';

export default function TwoFactorPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'totp' | 'backup'>('totp');
  const [code, setCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const trimmed = code.trim();
    if (trimmed.length === 0) {
      setError(mode === 'totp' ? '请输入 6 位动态验证码' : '请输入备用恢复码');
      return;
    }
    setPending(true);
    const { error: authError } =
      mode === 'totp'
        ? await authClient.twoFactor.verifyTotp({ code: trimmed, trustDevice })
        : await authClient.twoFactor.verifyBackupCode({ code: trimmed, trustDevice });
    if (authError) {
      setError(
        mode === 'totp'
          ? '验证码不正确或已过期，请重试（注意设备时间是否准确）'
          : '恢复码不正确或已被使用',
      );
      setPending(false);
      return;
    }
    // 跳首页并刷新：让服务端组件（顶部导航等）重新读取会话
    router.push('/');
    router.refresh();
  }

  return (
    <div>
      <h1 className="font-semibold font-serif text-2xl text-ink-900">两步验证</h1>
      <p className="mt-2 text-ink-500 text-sm">
        {mode === 'totp'
          ? '打开你的验证器应用（如 Aegis、1Password、Google Authenticator），输入当前的 6 位动态码。'
          : '输入启用两步验证时保存的备用恢复码（每个恢复码只能使用一次）。'}
      </p>

      <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-col gap-5">
        {error !== null ? <Alert variant="danger">{error}</Alert> : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="code">{mode === 'totp' ? '动态验证码' : '备用恢复码'}</Label>
          <Input
            id="code"
            type="text"
            inputMode={mode === 'totp' ? 'numeric' : 'text'}
            autoComplete="one-time-code"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={mode === 'totp' ? '6 位数字' : '形如 xxxxx-xxxxx'}
            className="font-mono tracking-widest"
          />
        </div>

        <label className="flex items-center gap-2.5 text-ink-700 text-sm">
          <input
            type="checkbox"
            checked={trustDevice}
            onChange={(e) => setTrustDevice(e.target.checked)}
            className="size-4 accent-brand-700"
          />
          信任此设备，60 天内免输验证码
        </label>

        <Button type="submit" disabled={pending}>
          {pending ? '验证中…' : '验证并登录'}
        </Button>
      </form>

      <div className="mt-6 flex flex-col gap-2 text-sm">
        <button
          type="button"
          onClick={() => {
            setMode((m) => (m === 'totp' ? 'backup' : 'totp'));
            setCode('');
            setError(null);
          }}
          className="self-start text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-900"
        >
          {mode === 'totp' ? '验证器不在身边？使用备用恢复码' : '改用验证器动态码'}
        </button>
        <Link
          href="/login"
          className="self-start text-ink-500 underline decoration-ink-300 underline-offset-2 hover:text-ink-700"
        >
          返回登录
        </Link>
      </div>
    </div>
  );
}
