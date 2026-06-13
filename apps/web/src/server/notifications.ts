// 通知读写辅助（非 Server Action）。写入通常在业务事务内调用（与事件同事务，不丢不重）。
import type { Database } from '@harublog/db';
import { notifications } from '@harublog/db';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { extractMentionCandidates } from '@/lib/identity';
import { resolveMentionCandidates } from '@/server/identity';

export type NotificationKind =
  | 'comment_on_doc'
  | 'comment_reply'
  | 'mention'
  | 'new_post'
  | 'publish_approved'
  | 'publish_rejected'
  | 'doc_edited'
  | 'patrol_reverted'
  | 'suggestion_received'
  | 'suggestion_merged'
  | 'suggestion_rejected'
  | 'suggestion_changes'
  // 编辑建议（反馈，ADR-0010）：收到 / 被处理
  | 'feedback_received'
  | 'feedback_handled'
  // 文章从私有升级为公共（祝贺原作者，ADR-0007）
  | 'doc_promoted';

type TxLike = Pick<Database, 'insert'>;
type ReadLike = Pick<Database, 'select'>;

/**
 * 解析正文中的 @名字（统一身份：name 即句柄，允许中文），给被提及者发 mention 通知。
 * CJK 无词界：候选串按最长前缀匹配现役名与改名历史（见 server/identity）；发给自己自动跳过。
 * 在业务事务内调用，需同时具备 select（解析）与 insert（写通知）能力。
 */
export async function notifyMentions(
  tx: Pick<Database, 'select' | 'insert'>,
  params: { text: string; actorId: string; payload: Record<string, unknown> },
): Promise<void> {
  const candidates = extractMentionCandidates(params.text);
  if (candidates.length === 0) {
    return;
  }
  const resolved = await resolveMentionCandidates(tx, candidates);
  const recipientIds = new Set([...resolved.values()].map((r) => r.userId));
  for (const id of recipientIds) {
    await insertNotification(tx, {
      recipientId: id,
      actorId: params.actorId,
      kind: 'mention',
      payload: params.payload,
    });
  }
}

/**
 * 写一条通知。recipientId === actorId 时跳过（不给自己发通知）。
 * 在业务事务内调用：通知与触发事件同生共死。
 */
export async function insertNotification(
  tx: TxLike,
  params: {
    recipientId: string | null;
    actorId: string;
    kind: NotificationKind;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  const { recipientId, actorId, kind, payload } = params;
  if (recipientId === null || recipientId === actorId) {
    return;
  }
  await tx.insert(notifications).values({ userId: recipientId, kind, payload });
}

/** 当前用户未读通知数（顶栏角标用）。 */
export async function countUnread(db: ReadLike, userId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return rows[0]?.n ?? 0;
}

export interface NotificationRow {
  id: string;
  kind: string;
  payload: unknown;
  readAt: Date | null;
  createdAt: Date;
}

/** 当前用户最近通知（倒序）。 */
export async function listNotifications(
  db: ReadLike,
  userId: string,
  limit = 50,
): Promise<NotificationRow[]> {
  return db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      payload: notifications.payload,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}
