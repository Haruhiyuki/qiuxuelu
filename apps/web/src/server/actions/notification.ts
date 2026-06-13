'use server';

import { getDb, notifications } from '@harublog/db';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';

const uuidSchema = z.uuid();

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

/** 把单条通知标为已读（点进该条目时调用）。仅限本人、仅未读→已读，幂等。 */
export async function markNotificationRead(rawId: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: '请先登录' };
  }
  if (!uuidSchema.safeParse(rawId).success) {
    return { ok: false, error: '参数非法' };
  }
  const db = getDb();
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, rawId),
        eq(notifications.userId, session.user.id),
        isNull(notifications.readAt),
      ),
    );
  return { ok: true, data: null };
}
