'use client';

// 账户自助：公开资料（头像/简介/阶段）、改名（统一身份）、改密码（better-auth）、通知偏好、注销。
import { Alert, Button, Input, Label, Textarea, usePrompt, useToast } from '@harublog/ui';
import { X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState } from 'react';
import { uploadImageFile } from '@/components/editor/upload';
import { SettingsCard, SettingsGroup } from '@/components/settings-card';
import { authClient } from '@/lib/auth-client';
import { translateAuthError } from '@/lib/auth-errors';
import { EDUCATION_STAGES, type EducationEntry, LEGACY_STAGE_MAP } from '@/lib/education';
import { validateName } from '@/lib/identity';
import {
  deleteMyAccount,
  renameUser,
  setEmailNotifications,
  updateProfile,
} from '@/server/actions/account';
import { PasskeySection } from './passkey-section';
import { TwoFactorSection } from './two-factor-section';

type Notice = { kind: 'info' | 'danger'; text: string } | null;

export function AccountForm({
  initialName,
  email,
  emailVerified,
  emailNotifications,
  initialBio,
  initialEducationStage,
  initialEducation,
  initialImage,
  renameQuota,
  twoFactorEnabled,
}: {
  initialName: string;
  email: string;
  emailVerified: boolean;
  emailNotifications: boolean;
  initialBio: string;
  /** 旧单字段（兼容老资料）：仅当 initialEducation 为空时用作编辑起点 */
  initialEducationStage: string;
  initialEducation: EducationEntry[] | null;
  initialImage: string;
  /** 改名滚动窗口配额（服务端算好传入） */
  renameQuota: { remaining: number; limit: number; windowDays: number };
  twoFactorEnabled: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [nameNotice, setNameNotice] = useState<Notice>(null);
  const [nameBusy, setNameBusy] = useState(false);

  const [bio, setBio] = useState(initialBio);
  // 教育经历：优先用新结构；否则把旧单字段映射成一条作为编辑起点
  const [education, setEducation] = useState<EducationEntry[]>(() => {
    if (initialEducation && initialEducation.length > 0) {
      return initialEducation;
    }
    if (initialEducationStage) {
      return [{ stage: LEGACY_STAGE_MAP[initialEducationStage] ?? '其他', school: '', field: '' }];
    }
    return [];
  });
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

  // 教育经历增减/编辑（保存时服务端会丢空行并按阶段排序）
  function setEduRow(i: number, patch: Partial<EducationEntry>) {
    setEducation((prev) => prev.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  }
  function addEduRow() {
    setEducation((prev) => [...prev, { stage: '本科', school: '', field: '' }]);
  }
  function removeEduRow(i: number) {
    setEducation((prev) => prev.filter((_, j) => j !== i));
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setProfileBusy(true);
    setProfileNotice(null);
    const r = await updateProfile({ bio, education });
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
    if (trimmed === initialName) {
      setNameNotice({ kind: 'info', text: '名字未变化' });
      return;
    }
    const formatError = validateName(trimmed);
    if (formatError !== null) {
      setNameNotice({ kind: 'danger', text: formatError });
      return;
    }
    setNameBusy(true);
    setNameNotice(null);
    const r = await renameUser(trimmed);
    if (!r.ok) {
      setNameNotice({ kind: 'danger', text: r.error });
    } else {
      setNameNotice({ kind: 'info', text: '改名成功；指向旧名字的 @提及 会自动转到你的主页' });
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
    <div className="flex flex-col gap-12">
      {promptDialog}

      <SettingsGroup id="profile" title="个人资料">
        <SettingsCard title="头像与简介" description="公开展示在你的主页。">
          <form onSubmit={saveProfile} className="flex flex-col gap-4">
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
            <div className="flex flex-col gap-2">
              <Label>教育经历（自愿，公开展示）</Label>
              {education.length === 0 ? (
                <p className="text-ink-400 text-sm">还没有添加；点下方「添加一条」。</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {education.map((row, i) => (
                    // 移动端：每条一张卡，三项纵向铺满、删除在右下；桌面端横排成行
                    <li
                      key={i}
                      className="flex flex-col gap-2 rounded-md border border-ink-200 bg-paper-100 p-3 sm:flex-row sm:items-center sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0"
                    >
                      <select
                        aria-label="学历阶段"
                        value={row.stage}
                        onChange={(e) => setEduRow(i, { stage: e.target.value })}
                        className="h-9 w-full shrink-0 rounded-sm border border-ink-200 bg-paper-50 px-2 text-ink-800 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 sm:w-28"
                      >
                        {EDUCATION_STAGES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <Input
                        aria-label="学校"
                        value={row.school}
                        maxLength={100}
                        onChange={(e) => setEduRow(i, { school: e.target.value })}
                        placeholder="学校"
                        className="w-full sm:w-44"
                      />
                      <Input
                        aria-label="专业 / 方向（选填）"
                        value={row.field ?? ''}
                        maxLength={100}
                        onChange={(e) => setEduRow(i, { field: e.target.value })}
                        placeholder="专业 / 方向（选填）"
                        className="w-full sm:w-44"
                      />
                      <button
                        type="button"
                        onClick={() => removeEduRow(i)}
                        aria-label="删除这条"
                        className="self-end rounded p-1 text-ink-400 transition-colors hover:text-accent-700 sm:self-auto"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={addEduRow}
                className="self-start text-brand-700 text-sm transition-colors hover:text-brand-900"
              >
                + 添加一条
              </button>
              <p className="text-ink-400 text-xs">
                填学历阶段 +
                学校（专业/方向选填）；只填了阶段没填学校的会被忽略。保存后自动按阶段排序（如 本科 →
                硕士 → 博士）。
              </p>
            </div>
            <Button type="submit" loading={profileBusy} className="self-start">
              保存资料
            </Button>
          </form>
        </SettingsCard>

        <SettingsCard title="名字" description="署名与 @提及一体，全站唯一。">
          <form onSubmit={saveName} className="flex flex-col gap-3">
            {nameNotice ? (
              <Alert variant={nameNotice.kind === 'info' ? 'info' : 'danger'}>
                {nameNotice.text}
              </Alert>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="acc-name">名字</Label>
              <Input
                id="acc-name"
                value={name}
                maxLength={20}
                onChange={(e) => setName(e.target.value)}
                placeholder="2–20 字，可中文"
                className="w-56"
              />
            </div>
            <p className="text-ink-400 text-xs">
              {renameQuota.windowDays} 天内最多改名 {renameQuota.limit} 次（剩余{' '}
              {renameQuota.remaining} 次）；改名后旧名字的 @提及 会自动转到你的主页。
            </p>
            <Button
              type="submit"
              disabled={nameBusy || renameQuota.remaining <= 0}
              className="self-start"
            >
              {nameBusy ? '保存中…' : renameQuota.remaining <= 0 ? '本周改名次数已用完' : '改名'}
            </Button>
          </form>
        </SettingsCard>
      </SettingsGroup>

      <SettingsGroup id="security" title="账户与安全">
        <SettingsCard title="登录邮箱" description={email}>
          {verifyNotice ? (
            <Alert variant={verifyNotice.kind === 'info' ? 'info' : 'danger'}>
              {verifyNotice.text}
            </Alert>
          ) : null}
          {emailVerified ? (
            <p className="text-moss-700 text-sm">✓ 邮箱已验证（暂不支持自助修改邮箱）</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-ink-500 text-sm">邮箱尚未验证，验证后可解锁更多协作能力。</p>
              <Button variant="secondary" onClick={resendVerification} disabled={verifyBusy}>
                {verifyBusy ? '发送中…' : '发送验证邮件'}
              </Button>
            </div>
          )}
        </SettingsCard>

        <SettingsCard title="修改密码">
          <form onSubmit={savePassword} className="flex flex-col gap-3">
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
        </SettingsCard>

        <SettingsCard title="两步验证" description="登录时除密码外，再加一道验证器动态码。">
          <TwoFactorSection enabled={twoFactorEnabled} />
        </SettingsCard>

        <SettingsCard title="通行密钥">
          <PasskeySection />
        </SettingsCard>
      </SettingsGroup>

      <SettingsGroup id="notifications" title="通知">
        <SettingsCard
          title="邮件通知"
          description="站内通知不受此开关影响；高频的评论/回复不发邮件。"
        >
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
        </SettingsCard>
      </SettingsGroup>

      <SettingsGroup id="data" title="数据与账号">
        <SettingsCard
          title="导出与注销"
          description="注销为不可逆操作：个人资料将被匿名化、无法再登录；你的文章与贡献会保留并署名为「已注销用户」。"
          tone="danger"
        >
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
        </SettingsCard>
      </SettingsGroup>
    </div>
  );
}
