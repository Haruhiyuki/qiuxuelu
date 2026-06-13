import { documents, getDb, revisions, suggestions, user as userTable } from '@harublog/db';
import { can } from '@harublog/domain';
import { buildRevisionDiff } from '@harublog/kernel';
import { RevisionDiffView } from '@harublog/renderer';
import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { SuggestionActions } from '@/components/suggestions/suggestion-actions';
import { formatDateTime } from '@/lib/format';
import { getSession } from '@/lib/session';
import { loadActor } from '@/server/actors';
import { loadRevisionBlocks } from '@/server/revision-doc';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '修订申请', robots: { index: false } };

const STATUS_LABEL: Record<string, string> = {
  open: '待审',
  under_review: '审校中',
  changes_requested: '已要求修改',
  merged: '已合入',
  rejected: '已驳回',
  outdated: '已过期（主线前移）',
  withdrawn: '已撤回',
};

interface SuggestionPageProps {
  params: Promise<{ id: string }>;
}

export default async function SuggestionDetailPage({ params }: SuggestionPageProps) {
  const { id } = await params;
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const db = getDb();
  const rows = await db
    .select({
      id: suggestions.id,
      documentId: suggestions.documentId,
      authorId: suggestions.authorId,
      baseRevisionId: suggestions.baseRevisionId,
      headRevisionId: suggestions.headRevisionId,
      status: suggestions.status,
      note: suggestions.note,
      createdAt: suggestions.createdAt,
      authorName: userTable.name,
      docSlug: documents.slug,
      docTitle: documents.title,
      ownerId: documents.ownerId,
      editPolicy: documents.editPolicy,
      sectionId: documents.sectionId,
    })
    .from(suggestions)
    .innerJoin(documents, eq(documents.id, suggestions.documentId))
    .leftJoin(userTable, eq(userTable.id, suggestions.authorId))
    .where(eq(suggestions.id, id))
    .limit(1);
  const sg = rows[0];
  if (!sg) {
    notFound();
  }

  const actor = await loadActor(session.user.id);
  const isAuthor = sg.authorId === session.user.id;
  const canReview =
    actor !== null &&
    can(actor, 'suggestion.review', {
      sectionId: sg.sectionId,
      doc: {
        id: sg.documentId,
        ownerId: sg.ownerId ?? '',
        editPolicy: sg.editPolicy as 'suggest_only' | 'open' | 'semi' | 'locked',
        status: 'published',
      },
    }).allow;
  if (!isAuthor && !canReview) {
    notFound();
  }

  // 补丁 = base → head 的块级 diff
  const [baseBlocks, headBlocks] = await Promise.all([
    loadRevisionBlocks(db, sg.baseRevisionId),
    loadRevisionBlocks(db, sg.headRevisionId),
  ]);
  const diff = buildRevisionDiff(baseBlocks, headBlocks);

  // 当前发布修订是否已前移（base 过期提示）
  const seqRows = await db
    .select({ baseSeq: revisions.seq })
    .from(revisions)
    .where(eq(revisions.id, sg.baseRevisionId))
    .limit(1);
  const baseSeq = seqRows[0]?.baseSeq ?? 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <header className="border-ink-200 border-b pb-6">
        <p className="text-ink-500 text-sm">
          <Link href={`/a/${sg.docSlug}`} className="hover:text-brand-700">
            ← {sg.docTitle}
          </Link>
        </p>
        <h1 className="mt-2 font-semibold font-serif text-2xl text-ink-900">修订申请</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-500 text-sm">
          <span className="font-medium text-ink-700">{sg.authorName ?? '佚名'}</span>
          <span className="rounded-sm bg-paper-200 px-2 py-0.5 text-ink-700">
            {STATUS_LABEL[sg.status] ?? sg.status}
          </span>
          <time dateTime={sg.createdAt.toISOString()}>{formatDateTime(sg.createdAt)}</time>
          <span>基于第 {baseSeq} 号修订</span>
        </div>
        {sg.note ? (
          <p className="mt-3 border-ink-200 border-l-2 pl-3 text-ink-700 text-sm leading-relaxed">
            {sg.note}
          </p>
        ) : null}
      </header>

      <div className="py-6">
        <h2 className="mb-3 font-medium text-ink-800 text-sm">建议改动</h2>
        <RevisionDiffView diff={diff} />
      </div>

      <SuggestionActions
        suggestionId={sg.id}
        status={sg.status}
        isAuthor={isAuthor}
        canReview={canReview}
      />
    </div>
  );
}
