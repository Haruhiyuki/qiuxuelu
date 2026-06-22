'use client';

import { Alert, Button, Input, Label } from '@harublog/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { OAuthButtons } from '@/components/auth/oauth-buttons';
import { authClient } from '@/lib/auth-client';
import { translateAuthError } from '@/lib/auth-errors';
import { COVENANT_CONSENT_VERSION, LICENSE_CONSENT_VERSION } from '@/lib/consent';
import { validateName } from '@/lib/identity';

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;
// 与 better-auth 服务端默认值（minPasswordLength = 8）保持一致
const MIN_PASSWORD_LENGTH = 8;

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [licenseAccepted, setLicenseAccepted] = useState(false);
  const [covenantAccepted, setCovenantAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // 注册成功后进入「查收验证邮件」状态（强制邮箱验证：此时尚无会话，验证链接点击后自动登录）
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const [resend, setResend] = useState<'idle' | 'sending' | 'sent'>('idle');

  // 已登录用户不应停留在注册页（被链接/书签带过来时弹回首页）
  useEffect(() => {
    if (registeredEmail !== null) {
      return;
    }
    let cancelled = false;
    void authClient.getSession().then(({ data }) => {
      if (!cancelled && data?.user) {
        router.replace('/');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [registeredEmail, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const nameError = validateName(name);
    if (nameError !== null) {
      setError(nameError);
      return;
    }
    if (!EMAIL_PATTERN.test(email)) {
      setError('请输入有效的邮箱地址');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符`);
      return;
    }
    // 法律前置（PRD §7）：许可与公约未确认不得提交
    if (!licenseAccepted) {
      setError('请先确认同意以 CC BY-NC-SA 4.0 协议授权你发布的内容');
      return;
    }
    if (!covenantAccepted) {
      setError('请先确认已阅读并同意社区公约');
      return;
    }

    setPending(true);
    const { error: authError } = await authClient.signUp.email({
      name: name.trim(),
      email,
      password,
      // 服务端强制的同意凭证（版本号落库留痕），勾选框只是体验层
      licenseConsentVersion: LICENSE_CONSENT_VERSION,
      covenantConsentVersion: COVENANT_CONSENT_VERSION,
    });
    if (authError) {
      setError(translateAuthError(authError.code, authError.message));
      setPending(false);
      return;
    }
    // 强制邮箱验证下注册不建会话：留在本页提示查收验证邮件
    setRegisteredEmail(email);
    setPending(false);
  }

  async function handleResend() {
    if (registeredEmail === null || resend === 'sending') {
      return;
    }
    setResend('sending');
    await authClient.sendVerificationEmail({ email: registeredEmail, callbackURL: '/' });
    setResend('sent');
  }

  if (registeredEmail !== null) {
    return (
      <div>
        <h1 className="font-semibold font-serif text-2xl text-ink-900">查收验证邮件</h1>
        <p className="mt-3 text-ink-600 text-sm leading-relaxed">
          验证邮件已发送至 <span className="font-medium text-ink-800">{registeredEmail}</span>
          ，点击邮件中的链接即可完成验证并自动登录。
        </p>
        <p className="mt-2 text-ink-400 text-xs leading-relaxed">
          没收到？请检查垃圾邮件文件夹，或稍候片刻再重新发送。
        </p>
        <div className="mt-6 flex items-center gap-4">
          <Button
            type="button"
            variant="secondary"
            onClick={handleResend}
            disabled={resend !== 'idle'}
          >
            {resend === 'sending'
              ? '发送中…'
              : resend === 'sent'
                ? '已重新发送'
                : '重新发送验证邮件'}
          </Button>
          <Link
            href="/login"
            className="text-brand-700 text-sm underline decoration-brand-300 underline-offset-2 hover:text-brand-900"
          >
            去登录
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-serif text-2xl font-semibold text-ink-900">注册</h1>
      <p className="mt-2 text-sm text-ink-500">加入这本可协作的书，把你的求学经验留给后来者。</p>

      <OAuthButtons />

      <form onSubmit={handleSubmit} noValidate className="mt-5 flex flex-col gap-5">
        {error !== null ? <Alert variant="danger">{error}</Alert> : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">名字</Label>
          <Input
            id="name"
            type="text"
            autoComplete="nickname"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="2–20 字，可用中文"
            required
          />
          <p className="text-ink-400 text-xs">用作署名和 @ 名字；注册后 7 天内最多可改 2 次。</p>
        </div>

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
          <Label htmlFor="password">密码</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={`至少 ${MIN_PASSWORD_LENGTH} 个字符`}
            required
          />
        </div>

        <div className="flex flex-col gap-3 rounded-sm border border-ink-200 bg-paper-50 p-4">
          <label className="flex items-start gap-2.5 text-sm leading-relaxed text-ink-700">
            <input
              type="checkbox"
              checked={licenseAccepted}
              onChange={(e) => setLicenseAccepted(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-brand-700"
            />
            <span>
              我同意将我在本站发布的内容以{' '}
              <a
                href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans"
                rel="license noopener"
                target="_blank"
                className="text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-900"
              >
                CC BY-NC-SA 4.0
              </a>{' '}
              协议授权共享，允许他人在署名、非商业并以相同方式共享的前提下转载与修改。
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-sm leading-relaxed text-ink-700">
            <input
              type="checkbox"
              checked={covenantAccepted}
              onChange={(e) => setCovenantAccepted(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-brand-700"
            />
            <span>
              我已阅读并同意社区公约：尊重事实、友善协作，不发布违法、侵权或泄露他人隐私的内容。
            </span>
          </label>
        </div>

        <Button type="submit" disabled={pending} className="mt-2">
          {pending ? '注册中…' : '注册'}
        </Button>
      </form>

      <p className="mt-6 text-sm text-ink-500">
        已有账号？{' '}
        <Link
          href="/login"
          className="text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-900"
        >
          登录
        </Link>
      </p>
    </div>
  );
}
