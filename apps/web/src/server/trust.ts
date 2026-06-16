// 信任结算层：从源表聚合 TrustStats → domain.computeLevel → 物化进 user_trust（可重放，架构 §4 红线）。
// 「可重放」= recomputeTrust 是从当前数据派生的纯结算，对同一用户调用多次结果一致；
// trust_events 是辅助分账（看板/异常监控），不直接决定等级。
// 积分制（ADR-0016）：等级 = 是否发文(TL1) + 累计分(TL2) + 近一年窗口分(TL3) + 人工认证(TL4)。
import type { Database } from '@harublog/db';
import {
  comments,
  documents,
  feedback,
  siteSettings,
  suggestions,
  trustEvents,
  userTrust,
} from '@harublog/db';
import type { TrustEventKind, TrustStats, TrustThresholds } from '@harublog/domain';
import { computeLevel, DEFAULT_THRESHOLDS, TRUST_EVENT_DELTAS } from '@harublog/domain';
import { and, eq, sql } from 'drizzle-orm';

type Tx = Pick<Database, 'select' | 'insert' | 'update'>;

const MS_PER_DAY = 86_400_000;

/** 读 site_settings 的信任阈值（seed 写入 .thresholds）；缺失/损坏回落到缺省档。 */
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
  return DEFAULT_THRESHOLDS;
}

function isThresholds(t: unknown): t is TrustThresholds {
  return (
    typeof t === 'object' &&
    t !== null &&
    'windowDays' in t &&
    'tl2Points' in t &&
    'tl3WindowPoints' in t &&
    'points' in t
  );
}

/**
 * 从源表聚合用户当前 TrustStats（纯派生，可重放）。
 * 计分（ADR-0016）：发布文章 × publishDoc、可见行内批注 × inlineComment、编辑建议 × feedback、
 * 修订申请合入 × suggestionMerged。points 为全生命周期累计；windowPoints 仅计近 windowDays 天内
 * 发生的贡献（文章/批注/建议按 createdAt，合入按 resolvedAt）。
 */
export async function computeUserStats(
  db: Pick<Database, 'select'>,
  userId: string,
  now: Date,
  thresholds: TrustThresholds,
): Promise<TrustStats> {
  const windowStart = new Date(now.getTime() - thresholds.windowDays * MS_PER_DAY);
  const pv = thresholds.points;

  // 发布文章（owner + published）
  const docRows = await db
    .select({
      total: sql<number>`count(*)`,
      win: sql<number>`count(*) filter (where ${documents.createdAt} >= ${windowStart})`,
    })
    .from(documents)
    .where(and(eq(documents.ownerId, userId), eq(documents.status, 'published')));
  const docTotal = Number(docRows[0]?.total ?? 0);
  const docWin = Number(docRows[0]?.win ?? 0);

  // 行内批注（可见态）
  const inlineRows = await db
    .select({
      total: sql<number>`count(*)`,
      win: sql<number>`count(*) filter (where ${comments.createdAt} >= ${windowStart})`,
    })
    .from(comments)
    .where(
      and(
        eq(comments.authorId, userId),
        eq(comments.kind, 'inline'),
        eq(comments.status, 'visible'),
      ),
    );
  const inlineTotal = Number(inlineRows[0]?.total ?? 0);
  const inlineWin = Number(inlineRows[0]?.win ?? 0);

  // 编辑建议（feedback）
  const fbRows = await db
    .select({
      total: sql<number>`count(*)`,
      win: sql<number>`count(*) filter (where ${feedback.createdAt} >= ${windowStart})`,
    })
    .from(feedback)
    .where(eq(feedback.authorId, userId));
  const fbTotal = Number(fbRows[0]?.total ?? 0);
  const fbWin = Number(fbRows[0]?.win ?? 0);

  // 修订申请被采纳（merged）——窗口按合入时间 resolvedAt
  const sgRows = await db
    .select({
      total: sql<number>`count(*)`,
      win: sql<number>`count(*) filter (where ${suggestions.resolvedAt} >= ${windowStart})`,
    })
    .from(suggestions)
    .where(and(eq(suggestions.authorId, userId), eq(suggestions.status, 'merged')));
  const sgTotal = Number(sgRows[0]?.total ?? 0);
  const sgWin = Number(sgRows[0]?.win ?? 0);

  const points =
    pv.publishDoc * docTotal +
    pv.inlineComment * inlineTotal +
    pv.feedback * fbTotal +
    pv.suggestionMerged * sgTotal;
  const windowPoints =
    pv.publishDoc * docWin +
    pv.inlineComment * inlineWin +
    pv.feedback * fbWin +
    pv.suggestionMerged * sgWin;

  return { publishedDocs: docTotal, points, windowPoints };
}

export interface RecomputeResult {
  previousLevel: number;
  newLevel: number;
  changed: boolean;
  locked: boolean;
}

/**
 * 重算并物化用户信任等级（幂等可重放）。locked=true 时尊重 manual_level、不自动改动。
 * 自动结算只产出 0–3（TL4 = TL3 + 管理员认证，仅人工授予）。
 */
export async function recomputeTrust(
  tx: Tx,
  userId: string,
  now: Date = new Date(),
): Promise<RecomputeResult> {
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
  const stats = await computeUserStats(tx, userId, now, thresholds);
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
