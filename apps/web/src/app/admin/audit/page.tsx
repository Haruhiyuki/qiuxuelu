import { auditLog, getDb, user as userTable } from '@harublog/db';
import { desc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Pagination } from '@/components/pagination';
import { formatDateTime } from '@/lib/format';
import { getSession } from '@/lib/session';
import { loadActor } from '@/server/actors';

const PAGE_SIZE = 50;

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '审计日志', robots: { index: false } };

// 高危操作的中文动作名（审计可读化）
const ACTION_LABELS: Record<string, string> = {
  'doc.create': '创建文章',
  'doc.commit_revision': '提交修订',
  'doc.request_publish': '申请发布',
  'doc.rollback': '回滚',
  'doc.collab_edit': '协作直编',
  'publish_request.approve': '通过发布',
  'publish_request.reject': '驳回发布',
  'doc.publish_direct': '直接发布（免预审）',
  'comment.hide': '隐藏评论',
  'comment.ai_release': '放行 AI 拦截评论',
  'comment.ai_reject': '删除 AI 拦截评论',
  'flag.create': '举报',
  'flag.uphold': '采纳举报',
  'flag.dismiss': '驳回举报',
  'sanction.issue': '签发制裁',
  'sanction.revoke': '解除制裁',
  'role.grant': '任命角色',
  'role.revoke': '撤销角色',
  'trust.recompute': '重算信任',
  'trust.set_level': '设定等级',
  'patrol.approve': '巡查通过',
  'patrol.revert': '巡查回退',
};

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const actor = await loadActor(session.user.id);
  // 审计查看：管理员及以上
  const isAdmin = actor?.roles.some((r) => r.role === 'admin' || r.role === 'superadmin') ?? false;
  if (!isAdmin) {
    return (
      <div className="mx-auto w-full max-w-xl px-6 py-20 text-center">
        <h1 className="font-serif text-2xl text-ink-900">无权访问</h1>
        <p className="mt-3 text-ink-500 text-sm">审计日志仅管理员可查看。</p>
        <p className="mt-6 text-sm">
          <Link href="/" className="text-brand-700 hover:text-brand-900">
            ← 返回首页
          </Link>
        </p>
      </div>
    );
  }

  const db = getDb();
  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      subjectType: auditLog.subjectType,
      subjectId: auditLog.subjectId,
      detail: auditLog.detail,
      createdAt: auditLog.createdAt,
      actorName: userTable.name,
    })
    .from(auditLog)
    .leftJoin(userTable, eq(userTable.id, auditLog.actorId))
    .orderBy(desc(auditLog.id))
    .limit(PAGE_SIZE + 1)
    .offset((page - 1) * PAGE_SIZE);
  const hasNext = rows.length > PAGE_SIZE;
  const items = rows.slice(0, PAGE_SIZE);

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <header className="border-ink-200 border-b pb-6">
        <h1 className="font-semibold font-serif text-2xl text-ink-900">审计日志</h1>
        <p className="mt-2 text-ink-500 text-sm">
          高危操作记录（不可篡改的治理凭证），按时间倒序分页
        </p>
      </header>

      {items.length === 0 ? (
        <p className="py-10 text-ink-500 text-sm">暂无审计记录。</p>
      ) : (
        <ul className="mt-4 divide-y divide-ink-100">
          {items.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3 text-sm">
              <time dateTime={r.createdAt.toISOString()} className="font-mono text-ink-400 text-xs">
                {formatDateTime(r.createdAt)}
              </time>
              <span className="font-medium text-ink-800">{r.actorName ?? '系统'}</span>
              <span className="text-brand-700">{ACTION_LABELS[r.action] ?? r.action}</span>
              {r.subjectType ? (
                <span className="text-ink-400 text-xs">
                  {r.subjectType}:{(r.subjectId ?? '').slice(0, 8)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} hasNext={hasNext} basePath="/admin/audit" />
    </div>
  );
}
