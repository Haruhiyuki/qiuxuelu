'use client';

// 两步验证（TOTP）自助管理：启用 = 密码确认 → 扫码/抄密钥 → 保存恢复码 → 首个动态码校验通过才生效
// （better-auth twoFactor 插件语义：verifyTotp 成功前 twoFactorEnabled 不置真）。停用同样需密码确认。
import { Alert, Button, Input, Label, useToast } from '@harublog/ui';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { renderSVG } from 'uqr';
import { authClient } from '@/lib/auth-client';

interface SetupData {
  totpURI: string;
  backupCodes: string[];
}

export function TwoFactorSection({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function beginEnable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password.length === 0) {
      setError('请输入当前密码以确认身份');
      return;
    }
    setPending(true);
    const { data, error: authError } = await authClient.twoFactor.enable({ password });
    if (authError || data === null) {
      setError('密码不正确，或当前账号不支持两步验证（GitHub 登录账号需先设置密码）');
      setPending(false);
      return;
    }
    setSetup({ totpURI: data.totpURI, backupCodes: data.backupCodes });
    setPassword('');
    setPending(false);
  }

  async function confirmEnable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (code.trim().length === 0) {
      setError('请输入验证器中的 6 位动态码完成校验');
      return;
    }
    setPending(true);
    const { error: authError } = await authClient.twoFactor.verifyTotp({ code: code.trim() });
    if (authError) {
      setError('动态码不正确或已过期，请确认已正确添加并重试');
      setPending(false);
      return;
    }
    toast('两步验证已启用', 'success');
    setSetup(null);
    setCode('');
    setPending(false);
    router.refresh();
  }

  async function handleDisable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password.length === 0) {
      setError('请输入当前密码以确认身份');
      return;
    }
    setPending(true);
    const { error: authError } = await authClient.twoFactor.disable({ password });
    if (authError) {
      setError('密码不正确');
      setPending(false);
      return;
    }
    toast('两步验证已停用', 'success');
    setPassword('');
    setPending(false);
    router.refresh();
  }

  // 启用向导第二步：扫码 + 恢复码 + 首码校验
  if (setup !== null) {
    const secret = new URL(setup.totpURI).searchParams.get('secret') ?? '';
    const qrSrc = `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(setup.totpURI))}`;
    return (
      <section className="flex flex-col gap-4 border-ink-200 border-t pt-8">
        <h2 className="font-medium font-serif text-ink-800 text-lg">启用两步验证</h2>
        <ol className="flex list-decimal flex-col gap-4 pl-5 text-ink-700 text-sm leading-relaxed">
          <li>
            用验证器应用（Aegis、1Password、Google Authenticator 等）扫描二维码：
            <div className="mt-3 flex flex-wrap items-start gap-4">
              {/* uqr 生成的 SVG 以 data URI 挂给 img：不引入 HTML 注入面 */}
              <img
                src={qrSrc}
                alt="TOTP 配置二维码"
                width={144}
                height={144}
                className="rounded-sm border border-ink-200 bg-white p-2"
              />
              <p className="max-w-52 text-ink-500 text-xs leading-relaxed">
                无法扫码时，在验证器中手动添加密钥：
                <code className="mt-1 block break-all rounded-xs bg-paper-200 px-1.5 py-1 font-mono">
                  {secret}
                </code>
              </p>
            </div>
          </li>
          <li>
            妥善保存以下备用恢复码（验证器丢失时唯一的登录手段，每个只能用一次）：
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-sm border border-ink-200 bg-paper-200 p-4 font-mono text-ink-800 text-sm sm:grid-cols-3">
              {setup.backupCodes.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
          </li>
          <li>
            输入验证器当前显示的动态码，完成启用：
            <form onSubmit={confirmEnable} noValidate className="mt-3 flex items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="totp-confirm">6 位动态码</Label>
                <Input
                  id="totp-confirm"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-36 font-mono tracking-widest"
                />
              </div>
              <Button type="submit" disabled={pending}>
                {pending ? '校验中…' : '完成启用'}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setSetup(null);
                  setCode('');
                  setError(null);
                }}
                className="pb-2 text-ink-500 text-sm hover:text-ink-700"
              >
                取消
              </button>
            </form>
          </li>
        </ol>
        {error !== null ? <Alert variant="danger">{error}</Alert> : null}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 border-ink-200 border-t pt-8">
      <h2 className="font-medium font-serif text-ink-800 text-lg">两步验证</h2>
      {enabled ? (
        <>
          <p className="text-ink-600 text-sm leading-relaxed">
            已启用。登录时除密码外，还需输入验证器动态码（或备用恢复码）。
          </p>
          <form onSubmit={handleDisable} noValidate className="flex items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tf-password">当前密码</Label>
              <Input
                id="tf-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-52"
              />
            </div>
            <Button type="submit" variant="danger" disabled={pending}>
              {pending ? '处理中…' : '停用两步验证'}
            </Button>
          </form>
        </>
      ) : (
        <>
          <p className="text-ink-600 text-sm leading-relaxed">
            为账号加一道防线：启用后登录还需验证器应用的动态码，密码泄露也难以被冒用。
          </p>
          <form onSubmit={beginEnable} noValidate className="flex items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tf-password">当前密码</Label>
              <Input
                id="tf-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-52"
              />
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? '处理中…' : '启用两步验证'}
            </Button>
          </form>
        </>
      )}
      {error !== null ? <Alert variant="danger">{error}</Alert> : null}
    </section>
  );
}
