'use server';

// 协作 token 签发动作：授权判定（owner / editor+ 角色 / TL4）在此完成，token 交客户端连 collab 网关。
// 架构 §6.3：实时协作仅对草稿态、且仅对作者与 TL4/editor 开放。
import { documents, getDb } from '@harublog/db';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';
import { loadActor } from '@/server/actors';
import { signCollabToken } from '@/server/collab-token';

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 小时

/** 实时协作授权：作者本人 / 板块编辑+ 角色 / TL4 共建者。 */
function mayRealtimeEdit(
  actor: { id: string; trustLevel: number; roles: { role: string; sectionId: string | null }[] },
  ownerId: string | null,
  sectionId: string,
): boolean {
  if (ownerId !== null && actor.id === ownerId) {
    return true;
  }
  if (actor.trustLevel >= 4) {
    return true;
  }
  return actor.roles.some((r) => {
    if (r.role === 'admin' || r.role === 'superadmin') {
      return true;
    }
    return (r.role === 'editor' || r.role === 'section_mod') && r.sectionId === sectionId;
  });
}

export async function issueCollabToken(rawDocId: string): Promise<ActionResult<{ token: string }>> {
  const secret = process.env.COLLAB_SECRET ?? '';
  if (secret.length === 0) {
    return fail('协作服务未配置');
  }
  const session = await getSession();
  if (!session) {
    return fail('请先登录');
  }
  const actor = await loadActor(session.user.id);
  if (!actor) {
    return fail('账号状态异常，请重新登录');
  }

  const db = getDb();
  const rows = await db
    .select({
      id: documents.id,
      ownerId: documents.ownerId,
      sectionId: documents.sectionId,
      status: documents.status,
    })
    .from(documents)
    .where(eq(documents.id, rawDocId))
    .limit(1);
  const doc = rows[0];
  if (!doc) {
    return fail('文章不存在');
  }
  if (!mayRealtimeEdit(actor, doc.ownerId, doc.sectionId)) {
    return fail('实时协作目前仅对作者、板块编辑与 TL4 共建者开放');
  }

  const token = signCollabToken(
    { userId: actor.id, name: session.user.name, docId: rawDocId },
    secret,
    TOKEN_TTL_MS,
  );
  return { ok: true, data: { token } };
}
