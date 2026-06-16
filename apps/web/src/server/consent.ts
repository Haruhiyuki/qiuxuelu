// 后置同意守卫：判断用户是否已确认当前版本的内容授权（CC BY-NC-SA）+ 社区公约。
// OAuth 用户创建时无凭证，须在贡献前经 /onboarding/consent 补齐；协议版本升级后存量用户也需重新确认。
import { type Database, getDb, user as userTable } from '@harublog/db';
import { eq } from 'drizzle-orm';
import { COVENANT_CONSENT_VERSION, LICENSE_CONSENT_VERSION } from '@/lib/consent';

export async function hasConsented(
  userId: string,
  db: Pick<Database, 'select'> = getDb(),
): Promise<boolean> {
  const rows = await db
    .select({
      lic: userTable.licenseConsentVersion,
      cov: userTable.covenantConsentVersion,
    })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  const u = rows[0];
  return u !== undefined && u.lic === LICENSE_CONSENT_VERSION && u.cov === COVENANT_CONSENT_VERSION;
}

/** 贡献动作的同意前置：未同意返回中文错误（引导去同意页），已同意返回 null。 */
export async function consentGate(userId: string): Promise<string | null> {
  return (await hasConsented(userId))
    ? null
    : '请先在「完成注册同意」页确认内容授权协议与社区公约后再贡献内容';
}
