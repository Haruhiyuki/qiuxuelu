import {
  comments,
  documents,
  flags,
  getDb,
  reviewItems,
  sections,
  user as userTable,
} from '@harublog/db';
import { Badge, EmptyState } from '@harublog/ui';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Flag } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AdminForbidden } from '@/components/admin/admin-forbidden';
import { AdminPageHeader } from '@/components/admin/admin-page-header';
import { FlagReviewPanel } from '@/components/flag-review-panel';
import { FLAG_REASON_LABELS } from '@/lib/flag-reasons';
import { getSession } from '@/lib/session';
import { isOverdue } from '@/lib/sla';
import { loadActor, sectionScopeForCapability } from '@/server/actors';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '举报处理', robots: { index: false } };

export default async function FlagQueuePage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  const actor = await loadActor(session.user.id);
  if (actor === null) {
    return <AdminForbidden reason="举报处理需要板块管理员及以上角色。" />;
  }
  const scope = sectionScopeForCapability(actor, 'flag.review');
  if (scope !== 'all' && scope.length === 0) {
    return <AdminForbidden reason="举报处理需要板块管理员及以上角色。" />;
  }

  const db = getDb();
  const items = await db
    .select({
      subjectType: reviewItems.subjectType,
      subjectId: reviewItems.subjectId,
      priority: reviewItems.priority,
      sectionName: sections.name,
      createdAt: reviewItems.createdAt,
    })
    .from(reviewItems)
    .leftJoin(sections, eq(sections.id, reviewItems.sectionId))
    .where(
      scope === 'all'
        ? and(eq(reviewItems.queue, 'flag'), eq(reviewItems.status, 'pending'))
        : and(
            eq(reviewItems.queue, 'flag'),
            eq(reviewItems.status, 'pending'),
            inArray(reviewItems.sectionId, scope),
          ),
    )
    .orderBy(desc(reviewItems.priority), desc(reviewItems.createdAt));

  // 逐项取被举报内容预览 + 举报理由聚合
  const cards = await Promise.all(
    items.map(async (item) => {
      const flagRows = await db
        .select({ reasonCode: flags.reasonCode, note: flags.note, reporter: userTable.name })
        .from(flags)
        .leftJoin(userTable, eq(userTable.id, flags.reporterId))
        .where(
          and(
            eq(flags.subjectType, item.subjectType),
            eq(flags.subjectId, item.subjectId),
            eq(flags.status, 'open'),
          ),
        );
      let preview = '';
      let link = '/';
      if (item.subjectType === 'comment') {
        const c = (
          await db
            .select({ body: comments.body, docSlug: documents.slug })
            .from(comments)
            .innerJoin(documents, eq(documents.id, comments.documentId))
            .where(eq(comments.id, item.subjectId))
            .limit(1)
        )[0];
        const text =
          c && typeof c.body === 'object' && c.body !== null && 'text' in c.body
            ? String((c.body as { text: unknown }).text)
            : '（内容已不存在）';
        preview = text;
        link = c ? `/a/${c.docSlug}#comments` : '/';
      } else {
        const d = (
          await db
            .select({ title: documents.title, slug: documents.slug })
            .from(documents)
            .where(eq(documents.id, item.subjectId))
            .limit(1)
        )[0];
        preview = d ? `文章：${d.title}` : '（文章已不存在）';
        link = d ? `/a/${d.slug}` : '/';
      }
      return { item, flagRows, preview, link };
    }),
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <AdminPageHeader
        title="举报处理"
        count={cards.length}
        description="按累计举报权重排序；采纳则隐藏内容，驳回则恢复。"
      />

      {cards.length === 0 ? (
        <EmptyState icon={<Flag />} title="没有待处理的举报" description="当前举报队列为空。" />
      ) : (
        <ul className="mt-4 flex flex-col gap-5">
          {cards.map(({ item, flagRows, preview, link }) => (
            <li
              key={`${item.subjectType}:${item.subjectId}`}
              className="rounded-sm border border-ink-200 bg-paper-50 p-4"
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="accent">权重 {item.priority}</Badge>
                <Badge variant="outline">{item.subjectType === 'comment' ? '评论' : '文章'}</Badge>
                {isOverdue(item.createdAt) ? <Badge variant="accent">超时</Badge> : null}
                {item.sectionName ? <span className="text-ink-500">{item.sectionName}</span> : null}
                <span className="text-ink-400">{flagRows.length} 人举报</span>
                <Link href={link} className="text-brand-700 hover:text-brand-900">
                  查看原文 →
                </Link>
              </div>
              <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-ink-700 text-sm">
                {preview}
              </p>
              <ul className="mt-2 flex flex-col gap-1 text-ink-500 text-xs">
                {flagRows.map((f, i) => (
                  <li key={`${f.reporter}-${i}`}>
                    ·{' '}
                    {FLAG_REASON_LABELS[f.reasonCode as keyof typeof FLAG_REASON_LABELS] ??
                      f.reasonCode}
                    {f.note ? `：${f.note}` : ''}（{f.reporter ?? '某用户'}）
                  </li>
                ))}
              </ul>
              <FlagReviewPanel
                subjectType={item.subjectType as 'comment' | 'document'}
                subjectId={item.subjectId}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
