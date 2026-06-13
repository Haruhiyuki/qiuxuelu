// 协作公示页（ADR-0010）：公共页公开 编辑建议 + 修订申请 + 修订记录，可对其打分/评论；
// 私有页仅公开修订记录（只读，无评议）。评议聚合同步到权限者后台（个人中心/审核页）。
import {
  documents,
  feedback as feedbackTable,
  getDb,
  revisions,
  suggestions,
  user as userTable,
} from '@harublog/db';
import { Badge, EmptyState } from '@harublog/ui';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { CollabReviewWidget } from '@/components/collab-review-widget';
import { formatDateTime } from '@/lib/format';
import { getSession } from '@/lib/session';
import { type ItemReviews, loadDocReviews } from '@/server/collab-review-read';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return { title: `协作公示 · ${slug}`, robots: { index: false } };
}

const SUG_STATUS: Record<string, string> = {
  open: '待审',
  under_review: '审核中',
  changes_requested: '待修改',
  merged: '已合入',
  rejected: '未采纳',
  outdated: '已过期',
  withdrawn: '已撤回',
};
const FB_STATUS: Record<string, string> = {
  open: '待处理',
  accepted: '已采纳',
  declined: '不采纳',
  resolved: '已处理',
};
const KIND_LABEL: Record<string, string> = {
  edit: '修订',
  collab_edit: '协作修订',
  rollback: '回退',
  merge: '合入',
  initial: '初版',
  publish: '发布',
};

function textOf(body: unknown): string {
  return typeof (body as { text?: unknown })?.text === 'string'
    ? (body as { text: string }).text
    : '';
}

const EMPTY: ItemReviews = { summary: { avg: 0, count: 0 }, reviews: [] };

export default async function CollabBoardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = getDb();
  const docRows = await db
    .select({
      id: documents.id,
      slug: documents.slug,
      title: documents.title,
      status: documents.status,
      visibility: documents.visibility,
    })
    .from(documents)
    .where(eq(documents.slug, slug))
    .limit(1);
  const doc = docRows[0];
  if (doc?.status !== 'published') {
    notFound();
  }
  const isPublic = doc.visibility === 'public';
  const session = await getSession();
  const canRate = isPublic && session !== null;

  // 修订记录（主线，suggestionId 为 null）
  const revs = await db
    .select({
      id: revisions.id,
      seq: revisions.seq,
      kind: revisions.kind,
      message: revisions.message,
      createdAt: revisions.createdAt,
      authorName: userTable.name,
    })
    .from(revisions)
    .leftJoin(userTable, eq(userTable.id, revisions.authorId))
    .where(and(eq(revisions.documentId, doc.id), isNull(revisions.suggestionId)))
    .orderBy(desc(revisions.seq))
    .limit(30);

  const sugs = isPublic
    ? await db
        .select({
          id: suggestions.id,
          status: suggestions.status,
          note: suggestions.note,
          createdAt: suggestions.createdAt,
          authorName: userTable.name,
        })
        .from(suggestions)
        .leftJoin(userTable, eq(userTable.id, suggestions.authorId))
        .where(eq(suggestions.documentId, doc.id))
        .orderBy(desc(suggestions.createdAt))
        .limit(30)
    : [];
  const fbs = isPublic
    ? await db
        .select({
          id: feedbackTable.id,
          status: feedbackTable.status,
          scope: feedbackTable.scope,
          quotedText: feedbackTable.quotedText,
          body: feedbackTable.body,
          createdAt: feedbackTable.createdAt,
          authorName: userTable.name,
        })
        .from(feedbackTable)
        .leftJoin(userTable, eq(userTable.id, feedbackTable.authorId))
        .where(eq(feedbackTable.documentId, doc.id))
        .orderBy(desc(feedbackTable.createdAt))
        .limit(30)
    : [];

  const reviews = await loadDocReviews(doc.id);
  const widget = (type: 'feedback' | 'suggestion' | 'revision', id: string) => {
    const r = reviews.get(id) ?? EMPTY;
    return (
      <CollabReviewWidget
        targetType={type}
        targetId={id}
        canRate={canRate}
        summary={r.summary}
        reviews={r.reviews}
      />
    );
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-ink-200 border-b pb-4">
        <Users className="h-5 w-5 self-center text-brand-600" aria-hidden />
        <h1 className="font-semibold font-serif text-2xl text-ink-900">协作公示</h1>
        <Link href={`/a/${slug}`} className="text-ink-400 text-sm hover:text-brand-700">
          ← {doc.title}
        </Link>
      </div>
      <p className="mt-3 text-ink-500 text-sm leading-relaxed">
        {isPublic
          ? '这是公共页，编辑建议 / 修订申请 / 修订记录全部公开；登录后可对它们打赞同度分并评论，评议会同步给权限者处理时参考。'
          : '这是私有页，仅公开修订记录；编辑建议与修订申请不公开，也不提供评议。'}
      </p>

      {isPublic ? (
        <Section title="编辑建议" count={fbs.length}>
          {fbs.length === 0 ? (
            <EmptyState title="还没有编辑建议" description="读者可在文章顶部「协作」里提意见。" />
          ) : (
            <ul className="flex flex-col gap-4">
              {fbs.map((f) => (
                <Item key={f.id}>
                  <Meta>
                    <Badge variant="outline">{FB_STATUS[f.status] ?? f.status}</Badge>
                    <span className="font-medium text-ink-600">{f.authorName ?? '佚名'}</span>
                    <Dot />
                    <span>{f.scope === 'fragment' ? '针对某段' : '针对全文'}</span>
                    <Dot />
                    <span>{formatDateTime(f.createdAt)}</span>
                  </Meta>
                  {f.quotedText !== null && f.quotedText.length > 0 ? (
                    <p className="mt-2 border-ochre-600 border-l-2 pl-2 text-ink-500 text-sm">
                      {f.quotedText}
                    </p>
                  ) : null}
                  <p className="mt-2 whitespace-pre-wrap text-ink-800 text-sm leading-relaxed">
                    {textOf(f.body)}
                  </p>
                  {widget('feedback', f.id)}
                </Item>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      {isPublic ? (
        <Section title="修订申请" count={sugs.length}>
          {sugs.length === 0 ? (
            <EmptyState
              title="还没有修订申请"
              description="贡献者可对文章提交改动申请，待审核合入。"
            />
          ) : (
            <ul className="flex flex-col gap-4">
              {sugs.map((sg) => (
                <Item key={sg.id}>
                  <Meta>
                    <Badge variant={sg.status === 'merged' ? 'brand' : 'accent'}>
                      {SUG_STATUS[sg.status] ?? sg.status}
                    </Badge>
                    <Link href={`/suggestions/${sg.id}`} className="hover:text-brand-700">
                      {sg.authorName ?? '佚名'} 的修订申请
                    </Link>
                    <Dot />
                    <span>{formatDateTime(sg.createdAt)}</span>
                  </Meta>
                  {sg.note !== null && sg.note.length > 0 ? (
                    <p className="mt-2 text-ink-700 text-sm leading-relaxed">{sg.note}</p>
                  ) : null}
                  {widget('suggestion', sg.id)}
                </Item>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      <Section title="修订记录" count={revs.length}>
        {revs.length === 0 ? (
          <EmptyState title="暂无修订记录" description="文章发布后，每次改动都会留痕在这里。" />
        ) : (
          <ul className="flex flex-col gap-4">
            {revs.map((rv) => (
              <Item key={rv.id}>
                <Meta>
                  <span className="font-medium text-ink-600">第 {rv.seq} 号</span>
                  <Badge variant="outline">{KIND_LABEL[rv.kind] ?? rv.kind}</Badge>
                  <span>{rv.authorName ?? '佚名'}</span>
                  <Dot />
                  <span>{formatDateTime(rv.createdAt)}</span>
                </Meta>
                {rv.message !== null && rv.message.length > 0 ? (
                  <p className="mt-2 text-ink-700 text-sm leading-relaxed">{rv.message}</p>
                ) : null}
                {isPublic ? widget('revision', rv.id) : null}
              </Item>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="mb-4 font-medium font-serif text-ink-800 text-lg">
        {title}
        <span className="ml-2 text-ink-400 text-sm">{count}</span>
      </h2>
      {children}
    </section>
  );
}

function Item({ children }: { children: ReactNode }) {
  return (
    <li className="rounded-md border border-ink-200 bg-paper-50 p-4 shadow-paper">{children}</li>
  );
}

function Meta({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-400 text-xs">
      {children}
    </div>
  );
}

function Dot() {
  return (
    <span aria-hidden className="text-ink-300">
      ·
    </span>
  );
}
