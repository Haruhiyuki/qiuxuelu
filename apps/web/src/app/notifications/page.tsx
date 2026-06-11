import { getDb } from '@harublog/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { MarkReadButton } from '@/components/mark-read-button';
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
}

function readPayload(payload: unknown): PayloadShape {
  return typeof payload === 'object' && payload !== null ? (payload as PayloadShape) : {};
}

/** 通知 → 中文文案 + 跳转链接。 */
function describe(kind: string, p: PayloadShape): { text: string; href: string } {
  const title = p.title ?? '某篇文章';
  const by = p.byName ?? '有人';
  switch (kind) {
    case 'comment_on_doc':
      return { text: `${by} 评论了你的文章《${title}》`, href: `/a/${p.slug ?? ''}#comments` };
    case 'comment_reply':
      return { text: `${by} 回复了你在《${title}》下的评论`, href: `/a/${p.slug ?? ''}#comments` };
    case 'publish_approved':
      return { text: `你的文章《${title}》已通过审批并发布`, href: `/a/${p.slug ?? ''}` };
    case 'publish_rejected':
      return {
        text: `你的文章《${title}》的发布申请被驳回，可修改后重新申请`,
        href: `/write/${p.docId ?? ''}`,
      };
    case 'doc_edited':
      return { text: `有协作者编辑了你的文章《${title}》`, href: `/a/${p.slug ?? ''}/history` };
    case 'patrol_reverted':
      return { text: `你对《${title}》的编辑被巡查回退`, href: `/a/${p.slug ?? ''}/history` };
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
      <header className="flex items-center justify-between border-b border-ink-200 pb-6">
        <h1 className="font-serif text-2xl font-semibold text-ink-900">通知</h1>
        {hasUnread ? <MarkReadButton /> : null}
      </header>

      {rows.length === 0 ? (
        <p className="py-10 text-sm text-ink-500">还没有通知。</p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {rows.map((row) => {
            const { text, href } = describe(row.kind, readPayload(row.payload));
            return (
              <li key={row.id} className="flex items-start gap-3 py-4">
                <span
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${
                    row.readAt === null ? 'bg-accent-600' : 'bg-ink-200'
                  }`}
                  aria-hidden
                />
                <div className="flex flex-col gap-0.5">
                  <Link href={href} className="text-sm text-ink-800 hover:text-brand-700">
                    {text}
                  </Link>
                  <time dateTime={row.createdAt.toISOString()} className="text-xs text-ink-400">
                    {formatDateTime(row.createdAt)}
                  </time>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
