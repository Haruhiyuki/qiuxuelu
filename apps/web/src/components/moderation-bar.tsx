'use client';

// 文章页治理条（板块管理员+ 可见）：精选开关 + 锁定编辑 + 转为公共页面。
import { Button, useConfirm, useToast } from '@harublog/ui';
import { Lock, LockOpen } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { publicizeDocument, setEditPolicy, toggleFeatured } from '@/server/actions/moderation';

export interface ModerationBarProps {
  docId: string;
  featured: boolean;
  editPolicy: string;
  visibility: string;
  canFeature: boolean;
  canProtect: boolean;
  canPublicize: boolean;
}

export function ModerationBar({
  docId,
  featured,
  editPolicy,
  visibility,
  canFeature,
  canProtect,
  canPublicize,
}: ModerationBarProps) {
  const router = useRouter();
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [feat, setFeat] = useState(featured);
  const [policy, setPolicy] = useState(editPolicy);
  const [busy, setBusy] = useState(false);

  async function onToggleFeatured() {
    setBusy(true);
    const r = await toggleFeatured(docId, !feat);
    if (r.ok) {
      setFeat(!feat);
      toast(!feat ? '已设为精选' : '已取消精选', 'success');
      router.refresh();
    } else {
      toast(r.error, 'error');
    }
    setBusy(false);
  }

  async function onPublicize() {
    const ok = await confirm({
      title: '转为公共页面？',
      description:
        '这是对内容公共价值的认可：转公共后管理权交给板块编辑，资深贡献者可直接编辑（进巡查）。原作者身份保留，并会收到祝贺通知。此操作不可一键撤销。',
      confirmLabel: '转为公共',
    });
    if (!ok) {
      return;
    }
    setBusy(true);
    const r = await publicizeDocument(docId);
    if (r.ok) {
      toast('已转为公共页面', 'success');
      router.refresh();
    } else {
      toast(r.error, 'error');
    }
    setBusy(false);
  }

  async function onToggleLock() {
    const next = policy === 'locked' ? 'open' : 'locked';
    setBusy(true);
    const r = await setEditPolicy(docId, next);
    if (r.ok) {
      setPolicy(next);
      toast(next === 'locked' ? '已锁定编辑' : '已解除锁定', 'success');
      router.refresh();
    } else {
      toast(r.error, 'error');
    }
    setBusy(false);
  }

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 rounded-sm border border-ink-200 bg-paper-100 px-4 py-3 text-sm">
      {confirmDialog}
      <span className="font-medium text-ink-500">管理</span>
      {canPublicize && visibility !== 'public' ? (
        <Button size="sm" variant="secondary" loading={busy} onClick={onPublicize}>
          转为公共页面
        </Button>
      ) : null}
      {canFeature ? (
        <Button
          size="sm"
          variant={feat ? 'primary' : 'secondary'}
          loading={busy}
          onClick={onToggleFeatured}
        >
          {feat ? '已精选' : '设为精选'}
        </Button>
      ) : null}
      {canProtect ? (
        <Button
          size="sm"
          variant={policy === 'locked' ? 'primary' : 'secondary'}
          loading={busy}
          onClick={onToggleLock}
          title="锁定后仅管理员可直接编辑，其他人改为提交修订申请 / 编辑建议"
        >
          {policy === 'locked' ? (
            <>
              <Lock className="h-4 w-4" aria-hidden />
              已锁定编辑
            </>
          ) : (
            <>
              <LockOpen className="h-4 w-4" aria-hidden />
              锁定编辑
            </>
          )}
        </Button>
      ) : null}
    </div>
  );
}
