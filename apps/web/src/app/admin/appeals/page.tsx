// 申诉复核队列（admin+）：列出待处理申诉，受理（撤销制裁）或驳回。
import { can } from '@harublog/domain';
import { EmptyState } from '@harublog/ui';
import { Scale } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AdminForbidden } from '@/components/admin/admin-forbidden';
import { AdminPageHeader } from '@/components/admin/admin-page-header';
import { AppealReviewPanel } from '@/components/appeal-review-panel';
import { formatDateTime } from '@/lib/format';
import { SANCTION_KIND_LABELS, type SanctionKindCode } from '@/lib/sanction-kinds';
import { getSession } from '@/lib/session';
import { loadActor } from '@/server/actors';
import { listOpenAppeals } from '@/server/appeals';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '申诉复核', robots: { index: false } };

export default async function AppealsQueuePage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  const actor = await loadActor(session.user.id);
  if (actor === null || !can(actor, 'user.suspend', {}).allow) {
    return <AdminForbidden reason="申诉复核需要管理员及以上角色。" />;
  }

  const appeals = await listOpenAppeals();

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <AdminPageHeader
        title="申诉复核"
        description="被制裁用户提交的申诉。受理将撤销对应制裁，驳回可附说明；处理结果记入审计。"
      />
      {appeals.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={<Scale />}
            title="没有待处理的申诉"
            description="当前没有需要复核的申诉。"
          />
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-4">
          {appeals.map((a) => (
            <li
              key={a.id}
              className="rounded-lg border border-ink-200 bg-paper-50 p-4 shadow-paper"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-medium text-ink-800">
                  {SANCTION_KIND_LABELS[a.sanctionKind as SanctionKindCode] ?? a.sanctionKind}
                </span>
                {a.sanctionSection !== null ? (
                  <span className="text-ink-400 text-xs">板块：{a.sanctionSection}</span>
                ) : (
                  <span className="text-ink-400 text-xs">全局</span>
                )}
                <Link
                  href={`/u/${a.appellantId}`}
                  className="ml-auto text-brand-700 text-xs transition-colors hover:text-brand-900"
                >
                  {a.appellantName ?? '匿名用户'} →
                </Link>
              </div>
              <p className="mt-1 text-ink-500 text-xs">原处罚理由：{a.sanctionReason}</p>
              <p className="mt-2 whitespace-pre-wrap text-ink-700 text-sm leading-relaxed">
                {a.reason}
              </p>
              <p className="mt-1 text-ink-400 text-xs">{formatDateTime(a.createdAt)} 提交</p>
              <AppealReviewPanel appealId={a.id} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
