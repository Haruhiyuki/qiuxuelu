'use server';

// 账户偏好：邮件通知开关（仅改本人记录，无需 can()——非治理操作，作用域限定自身）。
import { getDb, user as userTable } from '@harublog/db';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';

export async function setEmailNotifications(enabled: boolean): Promise<ActionResult> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: '请先登录' };
  }
  await getDb()
    .update(userTable)
    .set({ emailNotifications: enabled })
    .where(eq(userTable.id, session.user.id));
  return { ok: true, data: null };
}
