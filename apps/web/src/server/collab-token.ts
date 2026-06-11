// 协作 token 签发（与 apps/collab 的 verifyCollabToken 同一线格式）。
// 线格式：base64url(JSON{userId,name,docId,exp}) + "." + base64url(HMAC-SHA256(payload, COLLAB_SECRET))。
import { createHmac } from 'node:crypto';

export interface CollabClaims {
  userId: string;
  name: string;
  docId: string;
  exp: number;
}

/** 签发一个有效期 ttlMs 的协作 token。 */
export function signCollabToken(
  claims: Omit<CollabClaims, 'exp'>,
  secret: string,
  ttlMs: number,
): string {
  const payload = Buffer.from(
    JSON.stringify({ ...claims, exp: Date.now() + ttlMs }),
    'utf8',
  ).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
