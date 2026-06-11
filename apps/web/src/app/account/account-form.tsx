'use client';

// 账户自助：改昵称、改密码（better-auth 客户端）。注销账号涉及内容署名匿名化，留作单独设计。
import { Alert, Button, Input, Label } from '@harublog/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { translateAuthError } from '@/lib/auth-errors';

type Notice = { kind: 'info' | 'danger'; text: string } | null;

export function AccountForm({ initialName, email }: { initialName: string; email: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [nameNotice, setNameNotice] = useState<Notice>(null);
  const [nameBusy, setNameBusy] = useState(false);

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

  return (
    <div className="mt-8 flex flex-col gap-10">
      <form onSubmit={saveName} className="flex flex-col gap-3">
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
    </div>
  );
}
