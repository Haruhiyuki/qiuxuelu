'use client';

// 文章页治理入口（板块管理员+ 可见）：收成「管理」小胶囊，点击弹窗操作——
// 精选开关 / 锁定编辑 / 转为公共页面。与「协作」入口同款胶囊 + portal 弹窗。
import { useConfirm, useToast } from '@harublog/ui';
import { Globe, Lock, LockOpen, Settings2, Star } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

function Row({
  icon,
  title,
  desc,
  state,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  state?: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex w-full items-start gap-3 rounded-md border border-ink-200 bg-paper-100 p-3 text-left transition-colors hover:border-brand-300 hover:bg-brand-50 disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="mt-0.5 text-ink-400 transition-colors group-hover:text-brand-600">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink-800">{title}</p>
        <p className="mt-0.5 text-ink-500 text-sm leading-relaxed">{desc}</p>
      </div>
      {state ? (
        <span className="mt-0.5 shrink-0 rounded-full bg-paper-300 px-2 py-0.5 text-ink-600 text-xs">
          {state}
        </span>
      ) : null}
    </button>
  );
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
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

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

  async function onPublicize() {
    // 先收起本弹窗再确认，避免双层浮层叠加
    setOpen(false);
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

  return (
    <>
      {confirmDialog}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 px-2.5 py-0.5 text-ink-600 text-xs transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
        title="管理：精选 / 锁定编辑 / 转为公共"
      >
        <Settings2 className="h-3.5 w-3.5" aria-hidden />
        管理
      </button>

      {open
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
            >
              <button
                type="button"
                aria-label="关闭"
                onClick={() => setOpen(false)}
                className="overlay-in absolute inset-0 bg-ink-900/40 backdrop-blur-[1px]"
              />
              <div className="pop-in relative w-[min(30rem,94vw)] overflow-hidden rounded-lg border border-ink-200 bg-paper-50 shadow-float">
                <div className="flex items-center justify-between border-ink-200/70 border-b px-4 py-2.5">
                  <h2
                    id={titleId}
                    className="flex items-center gap-2 font-medium font-serif text-ink-800"
                  >
                    <Settings2 className="h-4 w-4 text-brand-600" aria-hidden />
                    管理
                  </h2>
                  <button
                    ref={closeRef}
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="关闭"
                    className="flex h-8 w-8 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-paper-200 hover:text-ink-800"
                  >
                    ✕
                  </button>
                </div>

                <div className="flex flex-col gap-2 p-4">
                  {canFeature ? (
                    <Row
                      icon={<Star className="h-4 w-4" aria-hidden />}
                      title={feat ? '取消精选' : '设为精选'}
                      desc="精选文章在板块与首页优先展示。"
                      state={feat ? '已精选' : '未精选'}
                      onClick={onToggleFeatured}
                      disabled={busy}
                    />
                  ) : null}
                  {canProtect ? (
                    <Row
                      icon={
                        policy === 'locked' ? (
                          <Lock className="h-4 w-4" aria-hidden />
                        ) : (
                          <LockOpen className="h-4 w-4" aria-hidden />
                        )
                      }
                      title={policy === 'locked' ? '解除锁定' : '锁定编辑'}
                      desc="锁定后仅管理员可直接编辑，其他人改为提交修订申请 / 编辑建议。"
                      state={policy === 'locked' ? '已锁定' : '开放'}
                      onClick={onToggleLock}
                      disabled={busy}
                    />
                  ) : null}
                  {canPublicize && visibility !== 'public' ? (
                    <Row
                      icon={<Globe className="h-4 w-4" aria-hidden />}
                      title="转为公共页面"
                      desc="认可其公共价值：管理权移交板块编辑，原作者身份保留。不可一键撤销。"
                      onClick={onPublicize}
                      disabled={busy}
                    />
                  ) : null}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
