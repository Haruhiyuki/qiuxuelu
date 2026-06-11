'use server';

// 点赞 / 收藏：登录即可（轻量互动，非内容贡献，不过 consent 闸）。切换式：有则删、无则增，返回新状态与计数。
import { docReactions, getDb } from '@harublog/db';
import { and, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';

type Kind = 'like' | 'bookmark';
const uuid = z.uuid();

export async function toggleReaction(
  docId: string,
  kind: Kind,
): Promise<ActionResult<{ active: boolean; count: number }>> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: '请先登录' };
  }
  if (kind !== 'like' && kind !== 'bookmark') {
    return { ok: false, error: '非法操作' };
  }
  if (!uuid.safeParse(docId).success) {
    return { ok: false, error: '文档参数非法' };
  }
  const db = getDb();
  const uid = session.user.id;
  const where = and(
    eq(docReactions.userId, uid),
    eq(docReactions.documentId, docId),
    eq(docReactions.kind, kind),
  );
  const existing = await db
    .select({ k: docReactions.kind })
    .from(docReactions)
    .where(where)
    .limit(1);
  let active: boolean;
  if (existing.length > 0) {
    await db.delete(docReactions).where(where);
    active = false;
  } else {
    await db
      .insert(docReactions)
      .values({ userId: uid, documentId: docId, kind })
      .onConflictDoNothing();
    active = true;
  }
  const c = await db
    .select({ n: count() })
    .from(docReactions)
    .where(and(eq(docReactions.documentId, docId), eq(docReactions.kind, kind)));
  return { ok: true, data: { active, count: Number(c[0]?.n ?? 0) } };
}
