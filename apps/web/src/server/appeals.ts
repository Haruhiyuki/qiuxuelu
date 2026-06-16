// 申诉读路径：账户页（我的生效制裁 + 申诉状态）与 /admin/appeals（待处理申诉）共用。
import { appeals, getDb, sanctions, sections, user as userTable } from '@harublog/db';
import { and, desc, eq, gt, inArray, isNull, or } from 'drizzle-orm';

export interface MySanction {
  id: string;
  kind: string;
  reason: string;
  sectionId: string | null;
  startsAt: Date;
  endsAt: Date | null;
  /** 该制裁最新一条申诉（无则 null） */
  appeal: { status: string; decisionNote: string | null } | null;
}

/** 当前用户「仍生效」的制裁（未撤销且未到期）+ 各自最新申诉状态。无制裁返回空数组。 */
export async function loadMySanctions(userId: string): Promise<MySanction[]> {
  const db = getDb();
  const now = new Date();
  const rows = await db
    .select({
      id: sanctions.id,
      kind: sanctions.kind,
      reason: sanctions.reason,
      sectionId: sanctions.sectionId,
      startsAt: sanctions.startsAt,
      endsAt: sanctions.endsAt,
    })
    .from(sanctions)
    .where(
      and(
        eq(sanctions.userId, userId),
        isNull(sanctions.revokedAt),
        or(isNull(sanctions.endsAt), gt(sanctions.endsAt, now)),
      ),
    )
    .orderBy(desc(sanctions.startsAt));
  if (rows.length === 0) {
    return [];
  }
  const ids = rows.map((r) => r.id);
  const appealRows = await db
    .select({
      sanctionId: appeals.sanctionId,
      status: appeals.status,
      decisionNote: appeals.decisionNote,
      createdAt: appeals.createdAt,
    })
    .from(appeals)
    .where(inArray(appeals.sanctionId, ids))
    .orderBy(desc(appeals.createdAt));
  const latestBySanction = new Map<string, { status: string; decisionNote: string | null }>();
  for (const a of appealRows) {
    if (!latestBySanction.has(a.sanctionId)) {
      latestBySanction.set(a.sanctionId, { status: a.status, decisionNote: a.decisionNote });
    }
  }
  return rows.map((r) => ({ ...r, appeal: latestBySanction.get(r.id) ?? null }));
}

export interface OpenAppeal {
  id: string;
  reason: string;
  createdAt: Date;
  appellantId: string;
  appellantName: string | null;
  sanctionKind: string;
  sanctionReason: string;
  sanctionSection: string | null;
}

/** 待处理（open）申诉列表 + 关联制裁与申诉人，供管理员复核。 */
export async function listOpenAppeals(): Promise<OpenAppeal[]> {
  return getDb()
    .select({
      id: appeals.id,
      reason: appeals.reason,
      createdAt: appeals.createdAt,
      appellantId: appeals.userId,
      appellantName: userTable.name,
      sanctionKind: sanctions.kind,
      sanctionReason: sanctions.reason,
      sanctionSection: sections.name,
    })
    .from(appeals)
    .innerJoin(sanctions, eq(sanctions.id, appeals.sanctionId))
    .leftJoin(userTable, eq(userTable.id, appeals.userId))
    .leftJoin(sections, eq(sections.id, sanctions.sectionId))
    .where(eq(appeals.status, 'open'))
    .orderBy(desc(appeals.createdAt));
}
