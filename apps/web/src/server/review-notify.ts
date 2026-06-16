// 待审通知：有新待办进入审校队列时，给「有权处理该队列、且作用域覆盖该板块」的成员写通知，
// worker 据 emailNotifications 偏好发邮件（kind=review_pending）。能力→角色由 domain ROLE_CAPS
// 派生，不硬编码；全局角色（admin/superadmin）覆盖所有板块，板块角色（editor/section_mod）须作用域命中。
import type { Database } from '@harublog/db';
import { roleGrants, user as userTable } from '@harublog/db';
import { type Capability, ROLE_CAPS, type Role, SECTION_SCOPED_ROLES } from '@harublog/domain';
import { and, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { insertNotification } from './notifications';

// 各审校队列 → 处理它所需的能力（edit_patrol 是高频例行巡查，走拉取式队列，不推邮件）
const QUEUE_CAPABILITY: Record<string, Capability> = {
  new_document: 'doc.publish',
  first_post: 'doc.publish',
  suggestion: 'suggestion.review',
  flag: 'flag.review',
};

type Tx = Pick<Database, 'select' | 'insert'>;

/**
 * 通知有权处理该队列的在任成员有新待办。
 * 收件人 = 持有对应能力的未撤销/未过期角色：全局角色全部、板块角色仅 section_id 命中者；
 * 排除提交者本人与被停用/已注销账号。重复入队不会重复触发（调用点在 reviewItems 真正新增时才调）。
 */
export async function notifyQueueReviewers(
  tx: Tx,
  params: {
    queue: string;
    sectionId: string | null;
    actorId: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  const cap = QUEUE_CAPABILITY[params.queue];
  if (cap === undefined) {
    return;
  }
  const roles = (Object.keys(ROLE_CAPS) as Role[]).filter((r) => ROLE_CAPS[r].includes(cap));
  const globalRoles = roles.filter((r) => !SECTION_SCOPED_ROLES.has(r));
  const sectionRoles = roles.filter((r) => SECTION_SCOPED_ROLES.has(r));

  const scopeConds = [];
  if (globalRoles.length > 0) {
    scopeConds.push(inArray(roleGrants.role, globalRoles));
  }
  if (sectionRoles.length > 0 && params.sectionId !== null) {
    scopeConds.push(
      and(inArray(roleGrants.role, sectionRoles), eq(roleGrants.sectionId, params.sectionId)),
    );
  }
  if (scopeConds.length === 0) {
    return;
  }

  const rows = await tx
    .select({ userId: roleGrants.userId })
    .from(roleGrants)
    .innerJoin(userTable, eq(userTable.id, roleGrants.userId))
    .where(
      and(
        isNull(roleGrants.revokedAt),
        or(isNull(roleGrants.expiresAt), gt(roleGrants.expiresAt, sql`now()`)),
        eq(userTable.status, 'active'),
        isNull(userTable.deletedAt),
        ne(roleGrants.userId, params.actorId),
        or(...scopeConds),
      ),
    );

  const recipientIds = [...new Set(rows.map((r) => r.userId))];
  for (const recipientId of recipientIds) {
    await insertNotification(tx, {
      recipientId,
      actorId: params.actorId,
      kind: 'review_pending',
      payload: params.payload,
    });
  }
}
