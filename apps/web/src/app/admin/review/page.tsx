import {
  documents,
  getDb,
  publishRequests,
  revisions,
  sections,
  user as userTable,
} from '@harublog/db';
import { ArticleRenderer } from '@harublog/renderer';
import { Badge, EmptyState } from '@harublog/ui';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { Inbox } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ReviewPanel } from '@/components/review-panel';
import { formatDateTime } from '@/lib/format';
import { getSession } from '@/lib/session';
import { isOverdue } from '@/lib/sla';
import { hasPublishGrant, loadActor, publishableSectionIds } from '@/server/actors';
import { loadRevisionDoc } from '@/server/revision-doc';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: '审批工作台' };

interface ReviewPageProps {
  searchParams: Promise<{ id?: string }>;
}

function Forbidden() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-20 text-center">
      <h1 className="font-serif text-2xl font-semibold text-ink-900">403 · 无权访问</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-500">
        审批工作台仅对持有发布权限的职务（责任编辑、板块版主、管理员）开放。
        发布权属于任命产生的职务权限——晋升给能力，任命给权力。
      </p>
      <p className="mt-6">
        <Link href="/" className="text-brand-700 hover:text-brand-900">
          ← 返回首页
        </Link>
      </p>
    </div>
  );
}

export default async function ReviewQueuePage({ searchParams }: ReviewPageProps) {
  const [{ id: selectedId }, session] = await Promise.all([searchParams, getSession()]);
  if (!session) {
    redirect('/login');
  }
  const actor = await loadActor(session.user.id);
  // 页面级守卫看角色清单；具体通过/驳回动作仍按板块域走 can() 双重把关
  if (!actor || !hasPublishGrant(actor)) {
    return <Forbidden />;
  }

  // 横向越权防线：板块域角色只能看到/预览自己授权板块的待审内容（架构 §4「板块级权力走指派制」）
  const allowedSections = publishableSectionIds(actor);
  if (allowedSections !== 'all' && allowedSections.length === 0) {
    return <Forbidden />;
  }

  const db = getDb();
  const pending = await db
    .select({
      id: publishRequests.id,
      status: publishRequests.status,
      createdAt: publishRequests.createdAt,
      revisionId: publishRequests.revisionId,
      requesterId: publishRequests.requesterId,
      docTitle: documents.title,
      sectionName: sections.name,
      requesterName: userTable.name,
      revisionSeq: revisions.seq,
      revisionMessage: revisions.message,
    })
    .from(publishRequests)
    .innerJoin(documents, eq(documents.id, publishRequests.documentId))
    .innerJoin(sections, eq(sections.id, documents.sectionId))
    .innerJoin(revisions, eq(revisions.id, publishRequests.revisionId))
    .leftJoin(userTable, eq(userTable.id, publishRequests.requesterId))
    .where(
      allowedSections === 'all'
        ? inArray(publishRequests.status, ['pending', 'in_review'])
        : and(
            inArray(publishRequests.status, ['pending', 'in_review']),
            inArray(documents.sectionId, allowedSections),
          ),
    )
    // M0 无认领租约：先到先审，按提交时间正序
    .orderBy(asc(publishRequests.createdAt));

  const selected =
    (selectedId !== undefined ? pending.find((r) => r.id === selectedId) : undefined) ??
    pending[0] ??
    null;
  const previewDoc = selected !== null ? await loadRevisionDoc(db, selected.revisionId) : null;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <header className="border-b border-ink-200 pb-6">
        <h1 className="font-serif text-2xl font-semibold text-ink-900">审批工作台</h1>
        <p className="mt-2 text-sm text-ink-500">
          待审 {pending.length} 项 · 先到先审（认领租约机制将在下一阶段上线）·
          不能审批自己提交的请求
        </p>
      </header>

      {pending.length === 0 ? (
        <EmptyState icon={<Inbox />} title="队列已清空" description="当前没有待审的发布请求。" />
      ) : (
        <div className="grid grid-cols-1 gap-8 py-8 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside>
            <ul className="flex flex-col gap-2">
              {pending.map((request) => (
                <li key={request.id}>
                  <Link
                    href={`/admin/review?id=${request.id}`}
                    className={`block rounded-sm border px-4 py-3 transition-colors ${
                      selected !== null && selected.id === request.id
                        ? 'border-brand-300 bg-brand-50'
                        : 'border-ink-200 bg-paper-50 hover:border-ink-300'
                    }`}
                  >
                    <p className="font-serif text-sm font-semibold text-ink-900">
                      {request.docTitle}
                    </p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
                      <span>{request.requesterName ?? '佚名'}</span>
                      <Badge variant="outline">{request.sectionName}</Badge>
                      <time dateTime={request.createdAt.toISOString()}>
                        {formatDateTime(request.createdAt)}
                      </time>
                      {isOverdue(request.createdAt) ? <Badge variant="accent">超时</Badge> : null}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </aside>

          {selected !== null ? (
            <section>
              <header className="border-b border-ink-200 pb-4">
                <h2 className="font-serif text-xl font-semibold text-ink-900">
                  {selected.docTitle}
                </h2>
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-500">
                  <span>作者：{selected.requesterName ?? '佚名'}</span>
                  <span>板块：{selected.sectionName}</span>
                  <span>待发布修订：#{selected.revisionSeq}</span>
                </p>
                {selected.revisionMessage !== null && selected.revisionMessage.length > 0 ? (
                  <p className="mt-2 text-sm text-ink-600">修订说明：{selected.revisionMessage}</p>
                ) : null}
              </header>

              <div className="prose-zh max-h-[60vh] overflow-y-auto border-b border-ink-200 py-6">
                <ArticleRenderer doc={previewDoc} headingAnchors={false} />
              </div>

              <div className="pt-6">
                <ReviewPanel
                  requestId={selected.id}
                  selfReview={selected.requesterId === session.user.id}
                />
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
