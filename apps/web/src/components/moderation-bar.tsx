'use client';

// 文章页治理条（板块管理员+ 可见）：精选开关 + 内容保护级切换。
import { Button, useToast } from '@harublog/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { setEditPolicy, toggleFeatured } from '@/server/actions/moderation';

const POLICY_LABELS: Record<string, string> = {
  open: '开放直编（TL2+）',
  semi: '半保护（TL3+）',
  suggest_only: '仅建议',
  locked: '锁定（仅管理）',
};

export interface ModerationBarProps {
  docId: string;
  featured: boolean;
  editPolicy: string;
  canFeature: boolean;
  canProtect: boolean;
}

export function ModerationBar({
  docId,
  featured,
  editPolicy,
  canFeature,
  canProtect,
}: ModerationBarProps) {
  const router = useRouter();
  const toast = useToast();
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

  async function onChangePolicy(next: string) {
    setBusy(true);
    const r = await setEditPolicy(docId, next);
    if (r.ok) {
      setPolicy(next);
      toast('保护级已更新', 'success');
      router.refresh();
    } else {
      toast(r.error, 'error');
    }
    setBusy(false);
  }

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 rounded-sm border border-ink-200 bg-paper-100 px-4 py-3 text-sm">
      <span className="font-medium text-ink-500">管理</span>
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
        <label className="flex items-center gap-2 text-ink-600">
          保护级
          <select
            value={policy}
            disabled={busy}
            onChange={(e) => onChangePolicy(e.target.value)}
            className="h-8 rounded-sm border border-ink-200 bg-paper-50 px-2 text-ink-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            {Object.entries(POLICY_LABELS).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
