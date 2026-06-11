// 引导首个超级管理员（自托管运维刚需：can() 红线下，没有 superadmin 平台无人可治理）。
// 用法：DATABASE_URL=... pnpm --filter @harublog/db exec tsx scripts/grant-superadmin.mts <email>
// 幂等：已是有效 superadmin 则跳过。授予会写 audit_log（actor=系统/被授予者自身）。
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../src/client';
import { auditLog, roleGrants, user as userTable } from '../src/schema/index';

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email?.includes('@')) {
    console.error('用法：tsx scripts/grant-superadmin.mts <email>');
    process.exit(1);
  }
  const db = getDb();
  const u = (await db.select().from(userTable).where(eq(userTable.email, email)).limit(1))[0];
  if (!u) {
    console.error(`找不到用户：${email}（请先在网站注册该邮箱）`);
    process.exit(1);
  }

  const existing = await db
    .select({ id: roleGrants.id })
    .from(roleGrants)
    .where(
      and(
        eq(roleGrants.userId, u.id),
        eq(roleGrants.role, 'superadmin'),
        isNull(roleGrants.sectionId),
        isNull(roleGrants.revokedAt),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    console.log(`已是 superadmin：${email}（无需重复）`);
    process.exit(0);
  }

  await db.transaction(async (tx) => {
    await tx.insert(roleGrants).values({
      userId: u.id,
      role: 'superadmin',
      sectionId: null,
      // 引导授予：授予者记为被授予者自身（系统初始化，无上级 actor）
      grantedBy: u.id,
    });
    await tx.insert(auditLog).values({
      actorId: u.id,
      action: 'role.bootstrap_superadmin',
      subjectType: 'user',
      subjectId: u.id,
      detail: { role: 'superadmin', via: 'cli-bootstrap' },
    });
  });
  console.log(`已授予 superadmin：${email}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
