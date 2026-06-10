'use server';

import { getDb, notifications } from '@harublog/db';
import { and, eq, isNull } from 'drizzle-orm';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';

/** 把当前用户的全部未读通知标为已读。 */
export async function markAllNotificationsRead(): Promise<ActionResult> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: '请先登录' };
  }
  const db = getDb();
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, session.user.id), isNull(notifications.readAt)));
  return { ok: true, data: null };
}
