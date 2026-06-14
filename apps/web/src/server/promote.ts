// 页面模式升级引擎（ADR-0007）：私有→公共。
// 触发：累计「他人贡献」超阈值自动转，或管理员手动转。升级是对内容公共价值的认可——
// 写审计、祝贺原作者、保留原作者身份（ownerId 不变）。
import {
  auditLog,
  type Database,
  documents,
  revisions,
  siteSettings,
  suggestions,
} from '@harublog/db';
import type { SQL } from 'drizzle-orm';
import { type AnyColumn, and, eq, isNotNull, ne, notExists, sql } from 'drizzle-orm';
import { insertNotification } from '@/server/notifications';

// 转公共门槛：累计 50 次「实质协作」（被采纳的修订申请 + 他人直编修订）。
// 仍可由 site_settings(key='doc.publicize') 覆盖（治理阈值不硬编码红线）。
const DEFAULT_THRESHOLD = 50;

/** 读 site_settings 的转公共阈值（key='doc.publicize'）；缺失/损坏回落默认 50。 */
export async function getPublicizeThreshold(db: Pick<Database, 'select'>): Promise<number> {
  const rows = await db
    .select({ value: siteSettings.value })
    .from(siteSettings)
    .where(eq(siteSettings.key, 'doc.publicize'))
    .limit(1);
  const v = rows[0]?.value;
  if (typeof v === 'object' && v !== null && 'threshold' in v) {
    const t = (v as { threshold?: unknown }).threshold;
    if (typeof t === 'number' && Number.isFinite(t) && t > 0) {
      return Math.floor(t);
    }
  }
  return DEFAULT_THRESHOLD;
}

/**
 * 统计一篇文档的「实质协作」次数（= 升级计数口径，ADR-0007）：
 * 非作者的 ① 被采纳的修订申请（suggestions.status='merged'）② 直编落地的主线修订。
 * 二者求和——只数真正改动了内容并被接纳的协作；评论、编辑建议、未采纳/撤回的修订申请等
 * 更轻的参与方式一律不计。作者匿名（ownerId=null）时其余人的贡献一律计入。
 *
 * 去重：合入修订申请会在主线生成 merge commit（suggestion_id=null），它已由 ① 计一次，
 * 故 ② 用 mergedRevisionId 把这些 merge commit 排除，避免同一次采纳被数两遍。
 */
export async function countCollabRecords(
  db: Pick<Database, 'select'>,
  docId: string,
  ownerId: string | null,
): Promise<number> {
  const notOwner = (col: AnyColumn): SQL => (ownerId === null ? sql`true` : ne(col, ownerId));

  const [sg, rv] = await Promise.all([
    // ① 被采纳（已合入）的修订申请
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(suggestions)
      .where(
        and(
          eq(suggestions.documentId, docId),
          eq(suggestions.status, 'merged'),
          notOwner(suggestions.authorId),
        ),
      ),
    // ② 他人直编落地的主线修订（排除 ① 的 merge commit，避免重复计数）
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(revisions)
      .where(
        and(
          eq(revisions.documentId, docId),
          notOwner(revisions.authorId),
          sql`${revisions.suggestionId} is null`,
          isNotNull(revisions.authorId),
          notExists(
            db
              .select({ x: sql`1` })
              .from(suggestions)
              .where(eq(suggestions.mergedRevisionId, revisions.id)),
          ),
        ),
      ),
  ]);
  return Number(sg[0]?.n ?? 0) + Number(rv[0]?.n ?? 0);
}

/**
 * 执行升级：把文档置为公共，写审计 + 祝贺原作者。by='auto' 表示阈值自动触发，否则为操作者 id。
 * 调用方应在确认仍为 private 后调用（本函数用 CAS 防并发重复升级）。
 */
export async function promoteToPublic(
  db: Database,
  docId: string,
  by: string,
  reason: 'threshold' | 'manual',
  meta: { collabCount?: number; sectionId?: string; actorId?: string } = {},
): Promise<boolean> {
  const updated = await db
    .update(documents)
    .set({
      visibility: 'public',
      publicizedAt: new Date(),
      publicizedBy: by,
      updatedAt: new Date(),
    })
    .where(and(eq(documents.id, docId), eq(documents.visibility, 'private')))
    .returning({ ownerId: documents.ownerId, title: documents.title, slug: documents.slug });
  const row = updated[0];
  if (row === undefined) {
    // 已被并发升级或不存在：不重复发祝贺
    return false;
  }
  await db.insert(auditLog).values({
    actorId: meta.actorId ?? null,
    action: 'doc.publicize',
    subjectType: 'document',
    subjectId: docId,
    sectionId: meta.sectionId ?? null,
    detail: { reason, by, collabCount: meta.collabCount ?? null },
  });
  // 祝贺原作者（保留其原始作者身份）。insertNotification 对 recipient=actor 自动跳过——
  // 这里 actorId 给一个与 owner 不同的占位（系统），保证祝贺能送达作者本人。
  if (row.ownerId !== null) {
    await insertNotification(db, {
      recipientId: row.ownerId,
      actorId: '__system__',
      kind: 'doc_promoted',
      payload: { documentId: docId, slug: row.slug, title: row.title, reason },
    });
  }
  return true;
}

/**
 * 自动升级检查：私有文档累计实质协作超阈值即升级。在「可能改变计数」的写路径后调用
 * （修订申请合入、他人直编修订落地），幂等且廉价（先看可见性再计数）。失败不应影响主流程。
 */
export async function maybeAutoPromote(db: Database, docId: string): Promise<void> {
  try {
    const rows = await db
      .select({
        visibility: documents.visibility,
        ownerId: documents.ownerId,
        sectionId: documents.sectionId,
      })
      .from(documents)
      .where(eq(documents.id, docId))
      .limit(1);
    const doc = rows[0];
    if (doc === undefined || doc.visibility !== 'private') {
      return;
    }
    const [count, threshold] = await Promise.all([
      countCollabRecords(db, docId, doc.ownerId),
      getPublicizeThreshold(db),
    ]);
    if (count >= threshold) {
      await promoteToPublic(db, docId, 'auto', 'threshold', {
        collabCount: count,
        sectionId: doc.sectionId,
      });
    }
  } catch {
    // 升级是增益副作用，绝不连累主写路径（建议/评论本身已落库）
  }
}
