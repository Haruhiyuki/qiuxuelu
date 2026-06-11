// 协作 token 验签（与 apps/web 的 issueCollabToken 同一线格式）。
// 线格式：base64url(JSON{userId,name,docId,exp}) + "." + base64url(HMAC-SHA256(payload, COLLAB_SECRET))。
// 鉴权与授权（owner/editor/TL4 判定）在 web 签发时完成；collab 只验签 + 校验 docId/过期。
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface CollabClaims {
  userId: string;
  name: string;
  docId: string;
  exp: number; // epoch 毫秒
}

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replaceAll('-', '+').replaceAll('_', '/'), 'base64');
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** 验签并返回声明；任何不合法（签名错/过期/格式错）返回 null。 */
export function verifyCollabToken(token: string, secret: string): CollabClaims | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) {
    return null;
  }
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }
  let claims: CollabClaims;
  try {
    claims = JSON.parse(b64urlDecode(payload).toString('utf8')) as CollabClaims;
  } catch {
    return null;
  }
  if (typeof claims.exp !== 'number' || claims.exp < Date.now()) {
    return null;
  }
  if (typeof claims.userId !== 'string' || typeof claims.docId !== 'string') {
    return null;
  }
  return claims;
}
