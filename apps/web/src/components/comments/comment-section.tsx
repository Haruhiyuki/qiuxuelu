import { comments, getDb, user as userTable } from '@harublog/db';
import { can } from '@harublog/domain';
import { and, asc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { formatDateTime } from '@/lib/format';
import { getSession } from '@/lib/session';
import { loadActor } from '@/server/actors';
import { CommentForm } from './comment-form';
import { CommentThread, type CommentView } from './comment-thread';

function bodyText(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'text' in body) {
    const t = (body as { text: unknown }).text;
    return typeof t === 'string' ? t : '';
  }
  return '';
}

export interface CommentSectionProps {
  docId: string;
  sectionId: string;
}

/** 文末讨论区（服务端组件）：自取会话与评论数据，渲染列表 + 发表/回复表单 + 治理隐藏入口。 */
export async function CommentSection({ docId, sectionId }: CommentSectionProps) {
  const db = getDb();
  const session = await getSession();
  const canReply = session !== null;
  let canModerate = false;
  if (session) {
    const actor = await loadActor(session.user.id);
    canModerate = actor !== null && can(actor, 'comment.moderate', { sectionId }).allow;
  }

  const rows = await db
    .select({
      id: comments.id,
      parentId: comments.parentId,
      body: comments.body,
      createdAt: comments.createdAt,
      authorName: userTable.name,
    })
    .from(comments)
    .leftJoin(userTable, eq(userTable.id, comments.authorId))
    .where(
      and(eq(comments.documentId, docId), eq(comments.kind, 'doc'), eq(comments.status, 'visible')),
    )
    .orderBy(asc(comments.createdAt));

  const toView = (r: (typeof rows)[number]): CommentView => ({
    id: r.id,
    authorName: r.authorName ?? '佚名',
    text: bodyText(r.body),
    createdAtLabel: formatDateTime(r.createdAt),
  });

  const repliesByParent = new Map<string, CommentView[]>();
  for (const r of rows) {
    if (r.parentId !== null) {
      const list = repliesByParent.get(r.parentId) ?? [];
      list.push(toView(r));
      repliesByParent.set(r.parentId, list);
    }
  }
  const topLevel = rows.filter((r) => r.parentId === null);
  const total = rows.length;

  return (
    <section id="comments" className="mt-12 border-t border-ink-200 pt-8">
      <h2 className="font-serif text-xl font-semibold text-ink-900">讨论（{total}）</h2>

      <div className="mt-6">
        {canReply ? (
          <CommentForm docId={docId} />
        ) : (
          <p className="text-sm text-ink-500">
            <Link href="/login" className="text-brand-700 hover:text-brand-900">
              登录
            </Link>
            后参与讨论。
          </p>
        )}
      </div>

      {topLevel.length > 0 ? (
        <ul className="mt-4 divide-y divide-ink-100">
          {topLevel.map((r) => (
            <CommentThread
              key={r.id}
              docId={docId}
              comment={toView(r)}
              replies={repliesByParent.get(r.id) ?? []}
              canReply={canReply}
              canModerate={canModerate}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-6 text-sm text-ink-400">还没有评论，来做第一个分享想法的人。</p>
      )}
    </section>
  );
}
