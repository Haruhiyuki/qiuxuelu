'use server';

// 记录后置同意（OAuth 用户或协议升级后的存量用户）：写入当前协议版本号，时间即 updatedAt（留痕）。
import { auditLog, getDb, user as userTable } from '@harublog/db';
import { eq } from 'drizzle-orm';
import { COVENANT_CONSENT_VERSION, LICENSE_CONSENT_VERSION } from '@/lib/consent';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';

export async function recordConsent(agree: boolean): Promise<ActionResult> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: '请先登录' };
  }
  if (!agree) {
    return { ok: false, error: '需勾选同意才能继续' };
  }
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(userTable)
      .set({
        licenseConsentVersion: LICENSE_CONSENT_VERSION,
        covenantConsentVersion: COVENANT_CONSENT_VERSION,
      })
      .where(eq(userTable.id, session.user.id));
    await tx.insert(auditLog).values({
      actorId: session.user.id,
      action: 'user.consent',
      subjectType: 'user',
      subjectId: session.user.id,
      detail: { license: LICENSE_CONSENT_VERSION, covenant: COVENANT_CONSENT_VERSION },
    });
  });
  return { ok: true, data: null };
}
