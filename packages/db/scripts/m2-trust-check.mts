// 本地校验：信任结算「可重放」+ 达标晋升（架构 §4 红线）。
// 运行：pnpm --filter @harublog/db exec tsx scripts/m2-trust-check.mts
// db 包按依赖铁律不可 import @harublog/domain，故此处内联一份 computeLevel 镜像（仅供本脚本独立核验
// SQL 聚合口径与晋升逻辑；真实 computeLevel 已由 domain 单测覆盖，web/server/trust.ts 调用真品）。
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../src/client';
import { comments, documents, sections, user as userTable, userTrust } from '../src/schema/index';

const db = getDb();
const MS = 86_400_000;

// 冷启动档（与 domain COLD_START_THRESHOLDS 一致）
const COLD = {
  tl1: { accountAgeDays: 1, activeDays: 1 },
  tl2: { activeDays: 5, commentsPosted: 3 },
};

function computeLevelMirror(s: {
  accountAgeDays: number;
  activeDays: number;
  commentsPosted: number;
}): number {
  if (s.accountAgeDays < COLD.tl1.accountAgeDays || s.activeDays < COLD.tl1.activeDays) return 0;
  if (s.activeDays < COLD.tl2.activeDays || s.commentsPosted < COLD.tl2.commentsPosted) return 1;
  return 2; // TL3 需 M3 建议数据，此脚本不覆盖
}

async function aggregate(userId: string, createdAt: Date) {
  const ageDays = Math.floor((Date.now() - createdAt.getTime()) / MS);
  const c = await db
    .select({ n: sql<number>`count(*)` })
    .from(comments)
    .where(eq(comments.authorId, userId));
  const dayRows = await db
    .select({ d: sql<string>`date(${comments.createdAt})` })
    .from(comments)
    .where(eq(comments.authorId, userId))
    .groupBy(sql`date(${comments.createdAt})`);
  return {
    accountAgeDays: ageDays,
    activeDays: dayRows.length,
    commentsPosted: Number(c[0]?.n ?? 0),
  };
}

async function main(): Promise<void> {
  const section = (
    await db.select().from(sections).where(eq(sections.slug, 'methodology')).limit(1)
  )[0];
  if (!section) throw new Error('请先 db:seed');

  const uid = `trust-check-${randomUUID().slice(0, 8)}`;
  const createdAt = new Date(Date.now() - 10 * MS); // 账号 backdate 10 天
  await db
    .insert(userTable)
    .values({ id: uid, name: '信任校验员', email: `${uid}@test.local`, createdAt });

  const docId = randomUUID();
  await db.insert(documents).values({
    id: docId,
    sectionId: section.id,
    slug: `trust-check-${randomUUID().slice(0, 8)}`,
    title: '信任校验载体',
    ownerId: uid,
    status: 'published',
    schemaVersion: 1,
  });

  // 6 条评论分布在 6 个不同日期（满足 tl2.activeDays=5、commentsPosted=3）
  for (let i = 0; i < 6; i++) {
    await db.insert(comments).values({
      documentId: docId,
      authorId: uid,
      kind: 'doc',
      body: { text: `评论 ${i}` },
      status: 'visible',
      createdAt: new Date(Date.now() - i * MS),
    });
  }

  const s1 = await aggregate(uid, createdAt);
  const level1 = computeLevelMirror(s1);
  const s2 = await aggregate(uid, createdAt); // 重放：再聚合一次
  const level2 = computeLevelMirror(s2);
  await db
    .insert(userTrust)
    .values({ userId: uid, level: level1 })
    .onConflictDoUpdate({ target: userTrust.userId, set: { level: level1 } });

  console.log(
    `RESULT ${JSON.stringify({
      stats: s1,
      level1,
      level2,
      replayConsistent: level1 === level2,
      promotedToTL2: level1 >= 2,
    })}`,
  );
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
