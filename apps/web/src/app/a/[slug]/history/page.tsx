import {
  documentRefs,
  documents,
  getDb,
  publishedSnapshots,
  revisions,
  user as userTable,
} from '@harublog/db';
import { can } from '@harublog/domain';
import { Badge } from '@harublog/ui';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { GitCompareArrows } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Breadcrumb } from '@/components/breadcrumb';
import { RestoreButton } from '@/components/restore-button';
import { revisionKindLabel } from '@/lib/doc-labels';
import { formatDate, formatDateTime } from '@/lib/format';
import { getSession } from '@/lib/session';
import { loadActor } from '@/server/actors';

export const dynamic = 'force-dynamic';

interface HistoryPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: HistoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const db = getDb();
  const rows = await db
    .select({ title: documents.title })
    .from(documents)
    .where(eq(documents.slug, slug))
    .limit(1);
  const doc = rows[0];
  return { title: doc ? `${doc.title} · 修订历史` : '文章不存在' };
}

export default async function HistoryPage({ params }: HistoryPageProps) {
  const { slug } = await params;
  const db = getDb();
  const docRows = await db
    .select({
      id: documents.id,
      title: documents.title,
      slug: documents.slug,
      ownerId: documents.ownerId,
      sectionId: documents.sectionId,
      editPolicy: documents.editPolicy,
      status: documents.status,
    })
    .from(documents)
    .where(eq(documents.slug, slug))
    .limit(1);
  const doc = docRows[0];
  if (!doc) {
    notFound();
  }

  const snapshotRows = await db
    .select({ revisionId: publishedSnapshots.revisionId })
    .from(publishedSnapshots)
    .where(eq(publishedSnapshots.documentId, doc.id))
    .limit(1);
  const publishedRevisionId = snapshotRows[0]?.revisionId ?? null;

  // 未发布文档的历史只对作者本人可见；已发布文档的全部谱系公开（全历史可直观追溯）
  const session = await getSession();
  if (publishedRevisionId === null) {
    if (!session || session.user.id !== doc.ownerId) {
      notFound();
    }
  }

  // 回退权：本页「回退到此版本」是作者的草稿操作——把草稿还原到旧版本，再到写作器重新发布。
  // 故仅作者本人可见（非作者撤销协作改动走巡查队列的即时回退，语义不同）；can() 仍统一把关制裁/停用。
  const isOwner = session !== null && session.user.id === doc.ownerId;
  let canRestore = false;
  if (session && isOwner) {
    const actor = await loadActor(session.user.id);
    canRestore =
      actor !== null &&
      can(actor, 'doc.edit_direct', {
        sectionId: doc.sectionId,
        doc: {
          id: doc.id,
          ownerId: doc.ownerId ?? '',
          editPolicy: doc.editPolicy as 'open' | 'locked',
          status: (doc.status === 'pending' ? 'draft' : doc.status) as
            | 'draft'
            | 'published'
            | 'archived',
        },
      }).allow;
  }

  // 当前草稿头：回退到它本身无意义，按钮不显示
  const draftRefRows = await db
    .select({ revisionId: documentRefs.revisionId })
    .from(documentRefs)
    .where(and(eq(documentRefs.documentId, doc.id), eq(documentRefs.name, 'draft')))
    .limit(1);
  const draftHeadId = draftRefRows[0]?.revisionId ?? null;

  const revisionRows = await db
    .select({
      id: revisions.id,
      seq: revisions.seq,
      kind: revisions.kind,
      message: revisions.message,
      blocksChanged: revisions.blocksChanged,
      createdAt: revisions.createdAt,
      authorName: userTable.name,
    })
    .from(revisions)
    .leftJoin(userTable, eq(userTable.id, revisions.authorId))
    // 只列主线修订；建议分支（suggestion_id 非空）不进主线历史（ADR-0004）
    .where(and(eq(revisions.documentId, doc.id), isNull(revisions.suggestionId)))
    .orderBy(desc(revisions.seq));

  // 初次发布日期：无独立首发时间戳，以最早一条主线修订（最小 seq = 内容初版）的创建时间为准；
  // 仅对已发布文档展示（草稿历史尚谈不上「发布」）。
  const firstPublishedAt =
    publishedRevisionId !== null
      ? (revisionRows[revisionRows.length - 1]?.createdAt ?? null)
      : null;

  // 每个修订的「上一版」= seq 比它小的最近一个（草稿分支 seq 单调）
  const ascSeqs = revisionRows.map((r) => r.seq).sort((a, b) => a - b);
  const prevSeqOf = new Map<number, number>();
  for (let i = 1; i < ascSeqs.length; i++) {
    const cur = ascSeqs[i];
    const prev = ascSeqs[i - 1];
    if (cur !== undefined && prev !== undefined) {
      prevSeqOf.set(cur, prev);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <Breadcrumb
        items={[
          { label: '首页', href: '/' },
          { label: doc.title, href: `/a/${doc.slug}` },
          { label: '修订历史' },
        ]}
      />

      {/* 页头：标题 + 谱系概述 + 修订对比入口（胶囊，与全站入口语言一致） */}
      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-ink-200 border-b pb-5">
        <div className="min-w-0">
          <h1 className="font-semibold font-serif text-2xl text-ink-900">修订历史</h1>
          <p className="mt-1.5 text-ink-500 text-sm">
            <span className="text-ink-700">{doc.title}</span> · 共 {revisionRows.length} 次修订
            <span className="text-ink-400"> · 修订不可变，全谱系公开可追溯</span>
          </p>
          {firstPublishedAt ? (
            <p className="mt-1 text-ink-400 text-xs">
              该内容于 {formatDate(firstPublishedAt)} 初次发布
            </p>
          ) : null}
        </div>
        <Link
          href={`/a/${doc.slug}/diff`}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ink-200 px-3 py-1 text-ink-600 text-xs transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
        >
          <GitCompareArrows className="h-3.5 w-3.5" aria-hidden />
          修订对比
        </Link>
      </div>

      {/* 谱系时间线：自新到旧，竖线串联；当前发布版高亮节点 */}
      {revisionRows.length > 0 ? (
        <ol className="mt-8">
          {revisionRows.map((rev, i) => {
            const isLast = i === revisionRows.length - 1;
            const isPublished = rev.id === publishedRevisionId;
            const prevSeq = prevSeqOf.get(rev.seq);
            const isRollback = rev.kind === 'rollback';
            return (
              <li key={rev.id} className="flex gap-4">
                {/* 节点 + 连线（节点列定宽，连线笔直） */}
                <div className="flex w-4 flex-col items-center">
                  <span
                    aria-hidden
                    className={`mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${
                      isPublished
                        ? 'border-brand-600 bg-brand-600 ring-2 ring-brand-100'
                        : 'border-ink-300 bg-paper-50'
                    }`}
                  />
                  {!isLast ? <span aria-hidden className="w-px flex-1 bg-ink-200" /> : null}
                </div>

                <div className={`min-w-0 flex-1 ${isLast ? 'pb-2' : 'pb-8'}`}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium font-serif text-ink-900">第 {rev.seq} 号修订</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        isRollback ? 'bg-ochre-50 text-ochre-800' : 'bg-paper-200 text-ink-500'
                      }`}
                    >
                      {revisionKindLabel(rev.kind)}
                    </span>
                    {isPublished ? <Badge variant="brand">当前发布</Badge> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 text-ink-400 text-xs">
                    <span className="text-ink-500">{rev.authorName ?? '佚名'}</span>
                    <span aria-hidden>·</span>
                    <time dateTime={rev.createdAt.toISOString()}>
                      {formatDateTime(rev.createdAt)}
                    </time>
                    <span aria-hidden>·</span>
                    <span>变更 {rev.blocksChanged} 个块</span>
                  </div>
                  {rev.message !== null && rev.message.length > 0 ? (
                    <p className="mt-2 text-ink-600 text-sm leading-relaxed">{rev.message}</p>
                  ) : (
                    <p className="mt-2 text-ink-400 text-sm italic">未填写修订说明</p>
                  )}
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    {prevSeq !== undefined ? (
                      <Link
                        href={`/a/${doc.slug}/diff?from=${prevSeq}&to=${rev.seq}`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 px-2.5 py-0.5 text-ink-600 text-xs transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                      >
                        <GitCompareArrows className="h-3.5 w-3.5" aria-hidden />
                        对比上一版 #{prevSeq} → #{rev.seq}
                      </Link>
                    ) : null}
                    {canRestore && rev.id !== draftHeadId ? (
                      <RestoreButton
                        docId={doc.id}
                        revisionId={rev.id}
                        seq={rev.seq}
                        published={publishedRevisionId !== null}
                      />
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-10 text-ink-500 text-sm">这篇文章还没有任何修订。</p>
      )}
    </div>
  );
}
