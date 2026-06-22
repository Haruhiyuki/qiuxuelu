import { getDb } from '@harublog/db';
import { EmptyState } from '@harublog/ui';
import { Bell } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Breadcrumb } from '@/components/breadcrumb';
import { MarkReadButton } from '@/components/mark-read-button';
import { NotificationItem } from '@/components/notification-item';
import { formatDateTime } from '@/lib/format';
import { getSession } from '@/lib/session';
import { listNotifications } from '@/server/notifications';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: '通知', robots: { index: false } };

interface PayloadShape {
  docId?: string;
  slug?: string;
  title?: string;
  byName?: string;
  reasonCode?: string;
  suggestionId?: string;
  status?: string;
  /** review_pending：待审队列类型（new_document/first_post/suggestion/flag） */
  queue?: string;
}

const FEEDBACK_STATUS_LABEL: Record<string, string> = {
  accepted: '已采纳',
  declined: '未采纳',
  resolved: '已处理',
};

function readPayload(payload: unknown): PayloadShape {
  return typeof payload === 'object' && payload !== null ? (payload as PayloadShape) : {};
}

/** 通知 → 中文文案 + 跳转链接。 */
function describe(kind: string, p: PayloadShape): { text: string; href: string } {
  const title = p.title ?? '某篇博客';
  const by = p.byName ?? '有人';
  switch (kind) {
    case 'doc_liked':
      return { text: `${by} 赞同了你的博客《${title}》`, href: `/a/${p.slug ?? ''}#reactions` };
    case 'comment_liked':
      return { text: `${by} 赞同了你在《${title}》下的评论`, href: `/a/${p.slug ?? ''}#comments` };
    case 'comment_on_doc':
      return { text: `${by} 评论了你的博客《${title}》`, href: `/a/${p.slug ?? ''}#comments` };
    case 'comment_reply':
      return { text: `${by} 回复了你在《${title}》下的评论`, href: `/a/${p.slug ?? ''}#comments` };
    case 'mention':
      return { text: `${by} 在《${title}》中提到了你`, href: `/a/${p.slug ?? ''}#comments` };
    case 'new_post':
      return { text: `你订阅的板块有新博客《${title}》`, href: `/a/${p.slug ?? ''}` };
    case 'publish_approved':
      return { text: `你的博客《${title}》已通过审批并发布`, href: `/a/${p.slug ?? ''}` };
    case 'publish_rejected':
      return {
        text: `你的博客《${title}》的发布申请被驳回，可修改后重新申请`,
        href: `/write/${p.docId ?? ''}`,
      };
    case 'doc_edited':
      return { text: `有协作者编辑了你的博客《${title}》`, href: `/a/${p.slug ?? ''}/history` };
    case 'patrol_reverted':
      return { text: `你对《${title}》的编辑被巡查回退`, href: `/a/${p.slug ?? ''}/history` };
    case 'suggestion_received':
      return {
        text: `${by} 对你的博客《${title}》提交了修订申请`,
        href: `/suggestions/${p.suggestionId ?? ''}`,
      };
    case 'suggestion_merged':
      return {
        text: `你对《${title}》的修订申请已被采纳合入`,
        href: `/suggestions/${p.suggestionId ?? ''}`,
      };
    case 'suggestion_rejected':
      return {
        text: `你对《${title}》的修订申请未被采纳`,
        href: `/suggestions/${p.suggestionId ?? ''}`,
      };
    case 'suggestion_changes':
      return {
        text: `你对《${title}》的修订申请被要求修改`,
        href: `/suggestions/${p.suggestionId ?? ''}`,
      };
    case 'feedback_received':
      return {
        text: `${by} 对你的博客《${title}》提了一条编辑建议`,
        href: '/account/feedback',
      };
    case 'feedback_handled':
      return {
        text: `你对《${title}》的编辑建议${FEEDBACK_STATUS_LABEL[p.status ?? ''] ?? '已处理'}`,
        href: '/account/feedback',
      };
    case 'doc_promoted':
      return {
        text: `🎉 恭喜！你的博客《${title}》已被认可有公共价值，升级为公共页面——你仍是它的原作者`,
        href: `/a/${p.slug ?? ''}`,
      };
    case 'review_pending':
      if (p.queue === 'suggestion') {
        return {
          text: `有一条修订申请待你审核${p.title ? `（《${p.title}》）` : ''}`,
          href: '/admin/suggestions',
        };
      }
      if (p.queue === 'flag') {
        return { text: '有一条举报待你复核', href: '/admin/flags' };
      }
      return { text: `有新博客《${p.title ?? '某篇博客'}》待你审批`, href: '/admin/review' };
    default:
      return { text: '你有一条新通知', href: '/' };
  }
}

export default async function NotificationsPage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  const db = getDb();
  const rows = await listNotifications(db, session.user.id);
  const hasUnread = rows.some((r) => r.readAt === null);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <Breadcrumb items={[{ label: '首页', href: '/' }, { label: '通知' }]} />
      <header className="flex items-center justify-between border-b border-ink-200 pb-6">
        <h1 className="font-serif text-2xl font-semibold text-ink-900">通知</h1>
        {hasUnread ? <MarkReadButton /> : null}
      </header>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Bell />}
          title="还没有通知"
          description="当有人评论、审校你的内容，或你的建议有进展时，会在这里看到。"
        />
      ) : (
        <ul className="divide-y divide-ink-100">
          {rows.map((row) => {
            const { text, href } = describe(row.kind, readPayload(row.payload));
            return (
              <NotificationItem
                key={row.id}
                id={row.id}
                href={href}
                text={text}
                time={formatDateTime(row.createdAt)}
                iso={row.createdAt.toISOString()}
                unread={row.readAt === null}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}
