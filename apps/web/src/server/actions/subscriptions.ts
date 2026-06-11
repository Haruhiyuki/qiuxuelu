'use server';

// 板块订阅：登录用户订阅/退订板块；订阅时生成退订 token（供邮件一键退订）。
import { getDb, subscriptions } from '@harublog/db';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';

const uuid = z.uuid();

export async function toggleSubscription(
  sectionId: string,
): Promise<ActionResult<{ subscribed: boolean }>> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: '请先登录' };
  }
  if (!uuid.safeParse(sectionId).success) {
    return { ok: false, error: '板块参数非法' };
  }
  const db = getDb();
  const uid = session.user.id;
  const where = and(eq(subscriptions.userId, uid), eq(subscriptions.sectionId, sectionId));
  const existing = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(where)
    .limit(1);
  if (existing.length > 0) {
    await db.delete(subscriptions).where(where);
    return { ok: true, data: { subscribed: false } };
  }
  await db
    .insert(subscriptions)
    .values({ userId: uid, sectionId, token: nanoid(32) })
    .onConflictDoNothing();
  return { ok: true, data: { subscribed: true } };
}
