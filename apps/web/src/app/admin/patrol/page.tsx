import {
  documents,
  getDb,
  reviewItems,
  revisions,
  sections,
  user as userTable,
} from '@harublog/db';
import { Badge, EmptyState } from '@harublog/ui';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AdminForbidden } from '@/components/admin/admin-forbidden';
import { AdminPageHeader } from '@/components/admin/admin-page-header';
import { PatrolPanel } from '@/components/patrol-panel';
import { formatDateTime } from '@/lib/format';
import { getSession } from '@/lib/session';
import { isOverdue } from '@/lib/sla';
import { loadActor, sectionScopeForCapability } from '@/server/actors';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '巡查队列', robots: { index: false } };

export default async function PatrolQueuePage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  const actor = await loadActor(session.user.id);
  if (actor === null) {
    return <AdminForbidden reason="巡查需要编辑及以上角色。" />;
  }
  const scope = sectionScopeForCapability(actor, 'queue.claim');
  if (scope !== 'all' && scope.length === 0) {
    return <AdminForbidden reason="巡查需要编辑及以上角色。" />;
  }

  const db = getDb();
  // review_items.subject_id 是 text（多态主体），不能直接 join uuid 的 revisions（uuid=text 无运算符）；
  // 故先取队列项，再按 subjectId 作为参数逐项加载修订（参数会按 uuid 列类型推断，安全）。
  const items = await db
    .select({
      revisionId: reviewItems.subjectId,
      createdAt: reviewItems.createdAt,
      sectionName: sections.name,
    })
    .from(reviewItems)
    .leftJoin(sections, eq(sections.id, reviewItems.sectionId))
    .where(
      scope === 'all'
        ? and(eq(reviewItems.queue, 'edit_patrol'), eq(reviewItems.status, 'pending'))
        : and(
            eq(reviewItems.queue, 'edit_patrol'),
            eq(reviewItems.status, 'pending'),
            inArray(reviewItems.sectionId, scope),
          ),
    )
    .orderBy(asc(reviewItems.createdAt));

  const rows = (
    await Promise.all(
      items.map(async (item) => {
        const rev = (
          await db
            .select({
              seq: revisions.seq,
              message: revisions.message,
              blocksChanged: revisions.blocksChanged,
              editorName: userTable.name,
              docSlug: documents.slug,
              docTitle: documents.title,
            })
            .from(revisions)
            .innerJoin(documents, eq(documents.id, revisions.documentId))
            .leftJoin(userTable, eq(userTable.id, revisions.authorId))
            .where(eq(revisions.id, item.revisionId))
            .limit(1)
        )[0];
        return rev ? { ...item, ...rev } : null;
      }),
    )
  ).filter((r): r is NonNullable<typeof r> => r !== null);

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <AdminPageHeader
        title="巡查队列"
        count={rows.length}
        description="协作者对已发布博客的直接编辑；标记已巡查，或一键回退。"
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck />}
          title="队列已清空"
          description="当前没有待巡查的修订。"
        />
      ) : (
        <ul className="mt-4 flex flex-col gap-5">
          {rows.map((r) => (
            <li key={r.revisionId} className="rounded-sm border border-ink-200 bg-paper-50 p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="outline">第 {r.seq} 号修订</Badge>
                {r.sectionName ? <span className="text-ink-500">{r.sectionName}</span> : null}
                <span className="text-ink-700">{r.editorName ?? '佚名'}</span>
                <span className="text-ink-500">改动 {r.blocksChanged} 个块</span>
                <time dateTime={r.createdAt.toISOString()} className="text-ink-400">
                  {formatDateTime(r.createdAt)}
                </time>
                {isOverdue(r.createdAt) ? <Badge variant="accent">超时</Badge> : null}
              </div>
              <p className="mt-1 font-serif text-ink-900">{r.docTitle}</p>
              {r.message ? (
                <p className="mt-1 text-ink-600 text-sm">{r.message}</p>
              ) : (
                <p className="mt-1 text-ink-400 text-sm">（无修改说明）</p>
              )}
              <Link
                href={`/a/${r.docSlug}/diff?to=${r.seq}`}
                className="text-brand-700 text-sm hover:text-brand-900"
              >
                查看本次改动差异 →
              </Link>
              <PatrolPanel revisionId={r.revisionId} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
