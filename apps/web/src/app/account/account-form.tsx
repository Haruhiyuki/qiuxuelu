'use client';

// 账户自助：公开资料（头像/简介/阶段）、改昵称、改密码（better-auth）、通知偏好、注销。
import { Alert, Button, Input, Label, Textarea, usePrompt, useToast } from '@harublog/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState } from 'react';
import { uploadImageFile } from '@/components/editor/upload';
import { authClient } from '@/lib/auth-client';
import { translateAuthError } from '@/lib/auth-errors';
import { deleteMyAccount, setEmailNotifications, updateProfile } from '@/server/actions/account';

type Notice = { kind: 'info' | 'danger'; text: string } | null;

const STAGES = ['', '初中', '高中', '大学', '毕业', '其他'];

export function AccountForm({
  initialName,
  email,
  emailVerified,
  emailNotifications,
  initialBio,
  initialEducationStage,
  initialImage,
}: {
  initialName: string;
  email: string;
  emailVerified: boolean;
  emailNotifications: boolean;
  initialBio: string;
  initialEducationStage: string;
  initialImage: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [nameNotice, setNameNotice] = useState<Notice>(null);
  const [nameBusy, setNameBusy] = useState(false);

  const [bio, setBio] = useState(initialBio);
  const [stage, setStage] = useState(initialEducationStage);
  const [image, setImage] = useState(initialImage);
  const [profileNotice, setProfileNotice] = useState<Notice>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const avatarRef = useRef<HTMLInputElement | null>(null);

  async function pickAvatar(file: File) {
    setProfileBusy(true);
    setProfileNotice(null);
    const uploaded = await uploadImageFile(file);
    if (uploaded === null) {
      setProfileNotice({ kind: 'danger', text: '头像上传失败' });
      setProfileBusy(false);
      return;
    }
    setImage(uploaded.url);
    const r = await updateProfile({ image: uploaded.url });
    setProfileNotice(
      r.ok ? { kind: 'info', text: '头像已更新' } : { kind: 'danger', text: r.error },
    );
    setProfileBusy(false);
    router.refresh();
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setProfileBusy(true);
    setProfileNotice(null);
    const r = await updateProfile({ bio, educationStage: stage });
    setProfileNotice(
      r.ok ? { kind: 'info', text: '资料已更新' } : { kind: 'danger', text: r.error },
    );
    setProfileBusy(false);
    if (r.ok) {
      router.refresh();
    }
  }

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

  const { prompt, promptDialog } = usePrompt();
  const toast = useToast();
  async function handleDelete() {
    const v = await prompt({
      title: '注销账号',
      label:
        '此操作不可逆：资料将被匿名化、无法再登录（文章/贡献会保留为「已注销用户」）。输入「注销」确认',
      placeholder: '注销',
      confirmLabel: '确认注销',
      required: true,
    });
    if (v === null) {
      return;
    }
    const r = await deleteMyAccount(v);
    if (!r.ok) {
      toast(r.error, 'error');
      return;
    }
    await authClient.signOut();
    router.push('/');
    router.refresh();
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
      {promptDialog}
      <form onSubmit={saveProfile} className="flex flex-col gap-3">
        <h2 className="font-medium font-serif text-ink-800 text-lg">公开资料</h2>
        {profileNotice ? (
          <Alert variant={profileNotice.kind === 'info' ? 'info' : 'danger'}>
            {profileNotice.text}
          </Alert>
        ) : null}
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-100 font-semibold font-serif text-2xl text-brand-700">
            {image.length > 0 ? (
              <img src={image} alt="头像" className="h-full w-full object-cover" />
            ) : (
              name.slice(0, 1)
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              loading={profileBusy}
              onClick={() => avatarRef.current?.click()}
            >
              更换头像
            </Button>
            <span className="text-ink-400 text-xs">JPEG/PNG/WebP/GIF，自动转 WebP</span>
            <input
              ref={avatarRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  void pickAvatar(f);
                }
                e.target.value = '';
              }}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="acc-bio">简介</Label>
          <Textarea
            id="acc-bio"
            value={bio}
            maxLength={280}
            rows={3}
            onChange={(e) => setBio(e.target.value)}
            placeholder="一句话介绍你自己（最长 280 字，公开展示）"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="acc-stage">教育阶段（自愿）</Label>
          <select
            id="acc-stage"
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className="h-9 w-40 rounded-sm border border-ink-200 bg-paper-50 px-3 text-ink-800 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {s === '' ? '不公开' : s}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" loading={profileBusy} className="self-start">
          保存资料
        </Button>
      </form>

      <section className="flex flex-col gap-2 border-ink-200 border-t pt-8">
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

      <section className="flex flex-col gap-3 border-ink-200 border-t pt-8">
        <h2 className="font-medium font-serif text-ink-800 text-lg">数据与账号</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/api/me/export"
            className="rounded-sm border border-ink-200 px-3 py-1.5 text-ink-700 text-sm hover:bg-paper-200"
          >
            导出我的数据
          </Link>
          <Button variant="danger" onClick={handleDelete}>
            注销账号
          </Button>
        </div>
        <p className="text-ink-400 text-xs">
          注销为不可逆操作：个人资料将被匿名化、无法再登录；你的文章与贡献会保留并署名为「已注销用户」。
        </p>
      </section>
    </div>
  );
}
