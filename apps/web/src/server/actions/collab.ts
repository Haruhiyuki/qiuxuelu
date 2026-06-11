'use server';

// 协作 token 签发动作：授权统一走 can()（红线：一切权限判断走唯一鉴权入口），token 交客户端连 collab 网关。
// 架构 §6.3：实时协作即对草稿做直接编辑（产 collab_checkpoint 修订），故鉴权能力 = doc.edit_direct——
// 这样制裁一票否决（no_edit/suspend）、账号停用、edit_policy 楼层全部自动生效，不再有自定义旁路。
import { documents, getDb } from '@harublog/db';
import { can, type DocCtx, explainDeny } from '@harublog/domain';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';
import { loadActor } from '@/server/actors';
import { signCollabToken } from '@/server/collab-token';

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 小时

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
      editPolicy: documents.editPolicy,
    })
    .from(documents)
    .where(eq(documents.id, rawDocId))
    .limit(1);
  const doc = rows[0];
  if (!doc) {
    return fail('文章不存在');
  }

  // 唯一鉴权入口：doc.edit_direct（含制裁/停用/edit_policy/所有权/角色/信任全套判定）
  const decision = can(actor, 'doc.edit_direct', {
    sectionId: doc.sectionId,
    doc: {
      id: doc.id,
      ownerId: doc.ownerId ?? '',
      editPolicy: doc.editPolicy as DocCtx['editPolicy'],
      status: doc.status as DocCtx['status'],
    },
  });
  if (!decision.allow) {
    return fail(explainDeny(decision.reason));
  }

  const token = signCollabToken(
    { userId: actor.id, name: session.user.name, docId: rawDocId },
    secret,
    TOKEN_TTL_MS,
  );
  return { ok: true, data: { token } };
}
