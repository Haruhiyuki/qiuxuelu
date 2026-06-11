'use client';

// 账户自助：改昵称、改密码（better-auth 客户端）。注销账号涉及内容署名匿名化，留作单独设计。
import { Alert, Button, Input, Label } from '@harublog/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { translateAuthError } from '@/lib/auth-errors';
import { setEmailNotifications } from '@/server/actions/account';

type Notice = { kind: 'info' | 'danger'; text: string } | null;

export function AccountForm({
  initialName,
  email,
  emailVerified,
  emailNotifications,
}: {
  initialName: string;
  email: string;
  emailVerified: boolean;
  emailNotifications: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [nameNotice, setNameNotice] = useState<Notice>(null);
  const [nameBusy, setNameBusy] = useState(false);

  const [verifyNotice, setVerifyNotice] = useState<Notice>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);

  const [emailPref, setEmailPref] = useState(emailNotifications);
  const [prefBusy, setPrefBusy] = useState(false);

  async function togglePref(enabled: boolean) {
    setEmailPref(enabled);
    setPrefBusy(true);
    const r = await setEmailNotifications(enabled);
    if (!r.ok) {
      setEmailPref(!enabled); // 回滚
    }
    setPrefBusy(false);
  }

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwNotice, setPwNotice] = useState<Notice>(null);
  const [pwBusy, setPwBusy] = useState(false);

  async function saveName(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setNameNotice({ kind: 'danger', text: '昵称不能为空' });
      return;
    }
    setNameBusy(true);
    setNameNotice(null);
    const { error } = await authClient.updateUser({ name: trimmed });
    if (error) {
      setNameNotice({ kind: 'danger', text: translateAuthError(error.code) });
    } else {
      setNameNotice({ kind: 'info', text: '昵称已更新' });
      router.refresh();
    }
    setNameBusy(false);
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (next.length < 8) {
      setPwNotice({ kind: 'danger', text: '新密码至少 8 位' });
      return;
    }
    if (next !== confirm) {
      setPwNotice({ kind: 'danger', text: '两次输入的新密码不一致' });
      return;
    }
    setPwBusy(true);
    setPwNotice(null);
    const { error } = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    });
    if (error) {
      setPwNotice({ kind: 'danger', text: translateAuthError(error.code) });
    } else {
      setPwNotice({ kind: 'info', text: '密码已更新，其他设备的登录已失效' });
      setCurrent('');
      setNext('');
      setConfirm('');
    }
    setPwBusy(false);
  }

  async function resendVerification() {
    setVerifyBusy(true);
    setVerifyNotice(null);
    const { error } = await authClient.sendVerificationEmail({ email, callbackURL: '/account' });
    setVerifyNotice(
      error
        ? { kind: 'danger', text: translateAuthError(error.code) }
        : { kind: 'info', text: '验证邮件已发送，请查收（含垃圾箱）' },
    );
    setVerifyBusy(false);
  }

  return (
    <div className="mt-8 flex flex-col gap-10">
      <section className="flex flex-col gap-2">
        <h2 className="font-medium font-serif text-ink-800 text-lg">邮箱验证</h2>
        {verifyNotice ? (
          <Alert variant={verifyNotice.kind === 'info' ? 'info' : 'danger'}>
            {verifyNotice.text}
          </Alert>
        ) : null}
        {emailVerified ? (
          <p className="text-moss-700 text-sm">✓ 邮箱已验证</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-ink-500 text-sm">邮箱尚未验证，验证后可解锁更多协作能力。</p>
            <Button variant="secondary" onClick={resendVerification} disabled={verifyBusy}>
              {verifyBusy ? '发送中…' : '发送验证邮件'}
            </Button>
          </div>
        )}
      </section>

      <form onSubmit={saveName} className="flex flex-col gap-3 border-ink-200 border-t pt-8">
        <h2 className="font-medium font-serif text-ink-800 text-lg">昵称</h2>
        {nameNotice ? (
          <Alert variant={nameNotice.kind === 'info' ? 'info' : 'danger'}>{nameNotice.text}</Alert>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="acc-name">显示名称</Label>
          <Input
            id="acc-name"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <p className="text-ink-400 text-xs">登录邮箱：{email}（暂不支持自助修改）</p>
        <Button type="submit" disabled={nameBusy} className="self-start">
          {nameBusy ? '保存中…' : '保存昵称'}
        </Button>
      </form>

      <form onSubmit={savePassword} className="flex flex-col gap-3 border-ink-200 border-t pt-8">
        <h2 className="font-medium font-serif text-ink-800 text-lg">修改密码</h2>
        {pwNotice ? (
          <Alert variant={pwNotice.kind === 'info' ? 'info' : 'danger'}>{pwNotice.text}</Alert>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="acc-cur">当前密码</Label>
          <Input
            id="acc-cur"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="acc-new">新密码（至少 8 位）</Label>
          <Input
            id="acc-new"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="acc-confirm">确认新密码</Label>
          <Input
            id="acc-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        <Button type="submit" disabled={pwBusy} className="self-start">
          {pwBusy ? '更新中…' : '更新密码'}
        </Button>
      </form>

      <section className="flex flex-col gap-3 border-ink-200 border-t pt-8">
        <h2 className="font-medium font-serif text-ink-800 text-lg">通知偏好</h2>
        <label className="flex cursor-pointer items-center gap-3 text-ink-700 text-sm">
          <input
            type="checkbox"
            checked={emailPref}
            disabled={prefBusy}
            onChange={(e) => togglePref(e.target.checked)}
            className="h-4 w-4"
          />
          接收邮件通知（建议被采纳/驳回、发布审核结果、巡查回退等）
        </label>
        <p className="text-ink-400 text-xs">站内通知不受此开关影响；高频的评论/回复不发邮件。</p>
      </section>
    </div>
  );
}
