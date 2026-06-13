// 个人中心 · 编辑建议（ADR-0010）：上半「待我处理」（我的文章 + 我负责板块收到的，可处理），
// 下半「我提交的」（含处理状态与回复）。修订申请/修订记录见各自入口（草稿箱 / 文章历史）。
import { documents, feedback, getDb, user as userTable } from '@harublog/db';
import { Badge, EmptyState } from '@harublog/ui';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { Inbox } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FeedbackHandle } from '@/components/feedback-handle';
import { formatDateTime } from '@/lib/format';
import { getSession } from '@/lib/session';
import { loadActor, sectionScopeForCapability } from '@/server/actors';
import { summarizeReviews } from '@/server/collab-review-read';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '我的编辑建议', robots: { index: false } };

const STATUS_LABEL: Record<string, string> = {
  open: '待处理',
  accepted: '已采纳',
  declined: '不采纳',
  resolved: '已处理',
};
const STATUS_VARIANT: Record<string, 'default' | 'brand' | 'accent' | 'outline'> = {
  open: 'accent',
  accepted: 'brand',
  declined: 'outline',
  resolved: 'default',
};

function textOf(body: unknown): string {
  return typeof (body as { text?: unknown })?.text === 'string'
    ? (body as { text: string }).text
    : '';
}

const SELECT = {
  id: feedback.id,
  scope: feedback.scope,
  quotedText: feedback.quotedText,
  body: feedback.body,
  status: feedback.status,
  reply: feedback.reply,
  createdAt: feedback.createdAt,
  handledAt: feedback.handledAt,
  slug: documents.slug,
  title: documents.title,
  authorName: userTable.name,
} as const;

export default async function MyFeedbackPage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  const actor = await loadActor(session.user.id);
  if (actor === null) {
    redirect('/');
  }
  const db = getDb();
  const scope = sectionScopeForCapability(actor, 'feedback.handle');

  // 待我处理：status=open 且（我的文章 或 我负责板块）
  const ownerCond = eq(documents.ownerId, actor.id);
  const inboxWhere =
    scope === 'all'
      ? eq(feedback.status, 'open')
      : scope.length > 0
        ? and(eq(feedback.status, 'open'), or(ownerCond, inArray(documents.sectionId, scope)))
        : and(eq(feedback.status, 'open'), ownerCond);
  const inbox = await db
    .select(SELECT)
    .from(feedback)
    .innerJoin(documents, eq(documents.id, feedback.documentId))
    .leftJoin(userTable, eq(userTable.id, feedback.authorId))
    .where(inboxWhere)
    .orderBy(desc(feedback.createdAt))
    .limit(50);
  // 公示页赞同度同步到后台供处理参考（ADR-0010）
  const sums = await summarizeReviews(
    'feedback',
    inbox.map((f) => f.id),
  );

  // 我提交的
  const mine = await db
    .select(SELECT)
    .from(feedback)
    .innerJoin(documents, eq(documents.id, feedback.documentId))
    .leftJoin(userTable, eq(userTable.id, feedback.authorId))
    .where(eq(feedback.authorId, actor.id))
    .orderBy(desc(feedback.createdAt))
    .limit(50);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="flex items-baseline gap-3">
        <Inbox className="h-5 w-5 self-center text-brand-600" aria-hidden />
        <h1 className="font-semibold font-serif text-2xl text-ink-900">编辑建议</h1>
        <p className="text-ink-400 text-sm">他人对文章的意见——不改内容，处理后回复</p>
      </div>

      <section className="mt-8">
        <h2 className="font-medium font-serif text-ink-800 text-lg">待我处理（{inbox.length}）</h2>
        {inbox.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="没有待处理的编辑建议" description="收到的新建议会出现在这里。" />
          </div>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {inbox.map((f) => (
              <li
                key={f.id}
                className="rounded-md border border-ink-200 bg-paper-50 p-4 shadow-paper"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-400 text-xs">
                  <span className="font-medium text-ink-600">{f.authorName ?? '佚名'}</span>
                  <span aria-hidden>·</span>
                  <Link href={`/a/${f.slug}`} className="truncate hover:text-brand-700">
                    {f.title}
                  </Link>
                  <span aria-hidden>·</span>
                  <span>{f.scope === 'fragment' ? '针对某段' : '针对全文'}</span>
                  <span aria-hidden>·</span>
                  <span>{formatDateTime(f.createdAt)}</span>
                </div>
                {f.quotedText !== null && f.quotedText.length > 0 ? (
                  <p className="mt-2 border-ochre-600 border-l-2 pl-2 text-ink-500 text-sm">
                    {f.quotedText}
                  </p>
                ) : null}
                <p className="mt-2 whitespace-pre-wrap text-ink-800 text-sm leading-relaxed">
                  {textOf(f.body)}
                </p>
                {sums.get(f.id) ? (
                  <p className="mt-2 text-ink-400 text-xs">
                    公示赞同度 {(sums.get(f.id)?.avg ?? 0).toFixed(1)} ·{' '}
                    {sums.get(f.id)?.count ?? 0} 人评议
                  </p>
                ) : null}
                <FeedbackHandle feedbackId={f.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="font-medium font-serif text-ink-800 text-lg">我提交的（{mine.length}）</h2>
        {mine.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="还没提过编辑建议"
              description="在文章顶部「协作」里可以对全文或某段提意见。"
            />
          </div>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {mine.map((f) => (
              <li
                key={f.id}
                className="rounded-md border border-ink-200 bg-paper-50 p-4 shadow-paper"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-400 text-xs">
                  <Badge variant={STATUS_VARIANT[f.status] ?? 'default'}>
                    {STATUS_LABEL[f.status] ?? f.status}
                  </Badge>
                  <Link href={`/a/${f.slug}`} className="truncate hover:text-brand-700">
                    {f.title}
                  </Link>
                  <span aria-hidden>·</span>
                  <span>{formatDateTime(f.createdAt)}</span>
                </div>
                {f.quotedText !== null && f.quotedText.length > 0 ? (
                  <p className="mt-2 border-ochre-600 border-l-2 pl-2 text-ink-500 text-sm">
                    {f.quotedText}
                  </p>
                ) : null}
                <p className="mt-2 whitespace-pre-wrap text-ink-800 text-sm leading-relaxed">
                  {textOf(f.body)}
                </p>
                {f.reply !== null && f.reply.length > 0 ? (
                  <p className="mt-2 rounded-sm bg-paper-200 p-2 text-ink-600 text-sm">
                    <span className="font-medium text-ink-700">回复：</span>
                    {f.reply}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
