// 信任结算层：从源表聚合 TrustStats → domain.computeLevel → 物化进 user_trust（可重放，架构 §4 红线）。
// 「可重放」= recomputeTrust 是从当前数据派生的纯结算，对同一用户调用多次结果一致；
// trust_events 是辅助分账（看板/异常监控），不直接决定等级。
import type { Database } from '@harublog/db';
import {
  comments,
  documents,
  flags,
  revisions,
  siteSettings,
  suggestions,
  trustEvents,
  user as userTable,
  userTrust,
} from '@harublog/db';
import type { TrustEventKind, TrustStats, TrustThresholds } from '@harublog/domain';
import { COLD_START_THRESHOLDS, computeLevel, TRUST_EVENT_DELTAS } from '@harublog/domain';
import { and, eq, gte, sql } from 'drizzle-orm';

type Tx = Pick<Database, 'select' | 'insert' | 'update'>;

const MS_PER_DAY = 86_400_000;

/** 读 site_settings 的信任阈值（seed 写入 .thresholds）；缺失/损坏回落到冷启动档。 */
export async function loadThresholds(db: Pick<Database, 'select'>): Promise<TrustThresholds> {
  const rows = await db
    .select({ value: siteSettings.value })
    .from(siteSettings)
    .where(eq(siteSettings.key, 'trust.thresholds'))
    .limit(1);
  const v = rows[0]?.value;
  if (typeof v === 'object' && v !== null && 'thresholds' in v) {
    const t = (v as { thresholds?: unknown }).thresholds;
    if (isThresholds(t)) {
      return t;
    }
  }
  return COLD_START_THRESHOLDS;
}

function isThresholds(t: unknown): t is TrustThresholds {
  return (
    typeof t === 'object' &&
    t !== null &&
    'windowDays' in t &&
    'tl1' in t &&
    'tl2' in t &&
    'tl3' in t
  );
}

/**
 * 从源表聚合用户当前 TrustStats（纯派生，可重放）。
 * M2 可得指标：账号年龄、可见评论数、活跃天数（评论+修订的去重日历日）。
 * 窗口指标里 suggestionsMerged/mergeRejectRatio 属 M3（建议流程）暂记 0/0；flagsAccuracy 由举报命中率得出（§③ 接入），此处给 1（不因未举报卡晋升）。
 */
export async function computeUserStats(
  db: Pick<Database, 'select'>,
  userId: string,
  accountCreatedAt: Date,
  now: Date,
  windowDays: number,
): Promise<TrustStats> {
  const accountAgeDays = Math.floor((now.getTime() - accountCreatedAt.getTime()) / MS_PER_DAY);

  const commentRows = await db
    .select({ n: sql<number>`count(*)` })
    .from(comments)
    .where(
      and(eq(comments.authorId, userId), eq(comments.kind, 'doc'), eq(comments.status, 'visible')),
    );
  const commentsPosted = Number(commentRows[0]?.n ?? 0);

  // 已发布文章数（发首文即达 T1，ADR-0010）
  const pubRows = await db
    .select({ n: sql<number>`count(*)` })
    .from(documents)
    .where(and(eq(documents.ownerId, userId), eq(documents.status, 'published')));
  const publishedDocs = Number(pubRows[0]?.n ?? 0);

  // 活跃天数 = 评论与修订的去重日历日（UTC 日期）合集大小
  const activeDays = await countActiveDays(db, userId);
  const windowStart = new Date(now.getTime() - windowDays * MS_PER_DAY);
  const windowActiveDays = await countActiveDays(db, userId, windowStart);
  const flagsAccuracy = await computeFlagsAccuracy(db, userId, windowStart);
  const sg = await computeSuggestionWindow(db, userId, windowStart);

  return {
    accountAgeDays,
    activeDays,
    commentsPosted,
    publishedDocs,
    window: {
      suggestionsMerged: sg.merged,
      mergeRejectRatio: sg.rejectRatio,
      flagsAccuracy,
      activeDays: windowActiveDays,
    },
  };
}

/** 窗口内建议合入数与被拒比例（喂 TL3 晋升条件）。无已裁决建议时 rejectRatio 记 0。 */
async function computeSuggestionWindow(
  db: Pick<Database, 'select'>,
  userId: string,
  windowStart: Date,
): Promise<{ merged: number; rejectRatio: number }> {
  const rows = await db
    .select({
      merged: sql<number>`count(*) filter (where ${suggestions.status} = 'merged')`,
      rejected: sql<number>`count(*) filter (where ${suggestions.status} = 'rejected')`,
    })
    .from(suggestions)
    .where(and(eq(suggestions.authorId, userId), gte(suggestions.createdAt, windowStart)));
  const merged = Number(rows[0]?.merged ?? 0);
  const rejected = Number(rows[0]?.rejected ?? 0);
  const decided = merged + rejected;
  return { merged, rejectRatio: decided === 0 ? 0 : rejected / decided };
}

/** 窗口内举报命中率 = upheld / (upheld + dismissed)；无已裁决举报时记 1（不因未举报卡晋升）。 */
async function computeFlagsAccuracy(
  db: Pick<Database, 'select'>,
  userId: string,
  windowStart: Date,
): Promise<number> {
  const rows = await db
    .select({
      upheld: sql<number>`count(*) filter (where ${flags.status} = 'upheld')`,
      resolved: sql<number>`count(*) filter (where ${flags.status} in ('upheld','dismissed'))`,
    })
    .from(flags)
    .where(and(eq(flags.reporterId, userId), gte(flags.createdAt, windowStart)));
  const upheld = Number(rows[0]?.upheld ?? 0);
  const resolved = Number(rows[0]?.resolved ?? 0);
  return resolved === 0 ? 1 : upheld / resolved;
}

/** 评论日 ∪ 修订日 的去重日历日数（可选起始时间）。 */
async function countActiveDays(
  db: Pick<Database, 'select'>,
  userId: string,
  since?: Date,
): Promise<number> {
  const commentDay = sql<string>`date(${comments.createdAt})`;
  const cRows = await db
    .select({ d: commentDay })
    .from(comments)
    .where(
      since
        ? and(eq(comments.authorId, userId), gte(comments.createdAt, since))
        : eq(comments.authorId, userId),
    )
    .groupBy(commentDay);
  const revDay = sql<string>`date(${revisions.createdAt})`;
  const rRows = await db
    .select({ d: revDay })
    .from(revisions)
    .where(
      since
        ? and(eq(revisions.authorId, userId), gte(revisions.createdAt, since))
        : eq(revisions.authorId, userId),
    )
    .groupBy(revDay);
  const days = new Set<string>();
  for (const r of cRows) days.add(r.d);
  for (const r of rRows) days.add(r.d);
  return days.size;
}

export interface RecomputeResult {
  previousLevel: number;
  newLevel: number;
  changed: boolean;
  locked: boolean;
}

/**
 * 重算并物化用户信任等级（幂等可重放）。locked=true 时尊重 manual_level、不自动改动。
 * 自动结算只产出 0–3（TL4 仅人工授予）。账号年龄由本函数自查，调用方只给 userId。
 */
export async function recomputeTrust(
  tx: Tx,
  userId: string,
  now: Date = new Date(),
): Promise<RecomputeResult> {
  const userRows = await tx
    .select({ createdAt: userTable.createdAt })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  const accountCreatedAt = userRows[0]?.createdAt ?? now;

  // 确保有行
  const existing = await tx
    .select({
      level: userTrust.level,
      locked: userTrust.locked,
      manualLevel: userTrust.manualLevel,
    })
    .from(userTrust)
    .where(eq(userTrust.userId, userId))
    .limit(1);
  const prev = existing[0];
  if (prev === undefined) {
    await tx.insert(userTrust).values({ userId }).onConflictDoNothing();
  }
  const previousLevel = prev?.level ?? 0;

  if (prev?.locked === true) {
    // 锁定：等级由 manual_level 决定，自动结算不介入
    return {
      previousLevel,
      newLevel: prev.manualLevel ?? previousLevel,
      changed: false,
      locked: true,
    };
  }

  const thresholds = await loadThresholds(tx);
  const stats = await computeUserStats(tx, userId, accountCreatedAt, now, thresholds.windowDays);
  const computed = computeLevel(stats, thresholds);
  // TL4 是人工授予的；自动结算不得把已是 TL4 的用户降下来（locked=false 但 manual 提级的情况已被上面拦截）
  const newLevel = Math.max(computed, previousLevel >= 4 ? 4 : computed);

  if (newLevel !== previousLevel) {
    await tx
      .update(userTrust)
      .set({
        level: newLevel,
        updatedAt: now,
        promotedAt: newLevel > previousLevel ? now : undefined,
      })
      .where(eq(userTrust.userId, userId));
  }
  return { previousLevel, newLevel, changed: newLevel !== previousLevel, locked: false };
}

/** 写一条信任事件（辅助分账：看板与异常晋升监控）；delta 取常量表，可由 payload 覆盖。 */
export async function emitTrustEvent(
  tx: Pick<Database, 'insert'>,
  params: {
    userId: string;
    kind: TrustEventKind;
    refType?: string;
    refId?: string;
    delta?: number;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  const { userId, kind, refType, refId, delta, payload } = params;
  await tx.insert(trustEvents).values({
    userId,
    kind,
    delta: delta ?? TRUST_EVENT_DELTAS[kind],
    refType,
    refId,
    payload,
  });
}
