'use server';

// 举报与处置（架构 §5.4）。举报权重随举报人 TL（Discourse flag weight）；多条举报聚合到一个
// review_items(queue='flag')，累计权重越线自动隐藏评论（事后复核）。裁决回写举报人命中率（喂信任窗口）。
import {
  auditLog,
  comments,
  documents,
  flags,
  getDb,
  reviewActions,
  reviewItems,
} from '@harublog/db';
import { can, explainDeny } from '@harublog/domain';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { FLAG_REASON_CODES } from '@/lib/flag-reasons';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';
import { loadActor } from '@/server/actors';

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const uuidSchema = z.uuid();
const subjectTypeSchema = z.enum(['comment', 'document']);
const noteSchema = z.string().trim().max(500, '说明最长 500 字');

// 累计举报权重达到此值即自动隐藏评论（待复核）；M2 取保守常量，后续可入 site_settings
const AUTO_HIDE_WEIGHT = 5;

/** 举报权重：随信任等级递增；TL0 计 0（不计入聚合，仅留痕，防新号刷举报）。 */
function flagWeight(trustLevel: number): number {
  return Math.max(0, trustLevel);
}

/** 解析被举报内容的所属板块（评论→其文档板块；文档→自身板块）。 */
async function resolveSubject(
  db: ReturnType<typeof getDb>,
  subjectType: 'comment' | 'document',
  subjectId: string,
): Promise<{ sectionId: string } | null> {
  if (subjectType === 'comment') {
    const rows = await db
      .select({ sectionId: documents.sectionId })
      .from(comments)
      .innerJoin(documents, eq(documents.id, comments.documentId))
      .where(eq(comments.id, subjectId))
      .limit(1);
    return rows[0] ?? null;
  }
  const rows = await db
    .select({ sectionId: documents.sectionId })
    .from(documents)
    .where(eq(documents.id, subjectId))
    .limit(1);
  return rows[0] ?? null;
}

export async function flagContent(
  rawSubjectType: string,
  rawSubjectId: string,
  rawReasonCode: string,
  rawNote: string,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session) {
    return fail('请先登录后再举报');
  }
  const actor = await loadActor(session.user.id);
  if (!actor) {
    return fail('账号状态异常，请重新登录');
  }
  const subjectType = subjectTypeSchema.safeParse(rawSubjectType);
  if (!subjectType.success || !uuidSchema.safeParse(rawSubjectId).success) {
    return fail('举报对象非法');
  }
  const reason = z.enum(FLAG_REASON_CODES).safeParse(rawReasonCode);
  if (!reason.success) {
    return fail('请选择举报理由');
  }
  const note = noteSchema.safeParse(rawNote);
  if (!note.success) {
    return fail(note.error.issues[0]?.message ?? '说明校验失败');
  }

  const decision = can(actor, 'flag.create', {});
  if (!decision.allow) {
    return fail(explainDeny(decision.reason));
  }

  const db = getDb();
  const subject = await resolveSubject(db, subjectType.data, rawSubjectId);
  if (subject === null) {
    return fail('被举报的内容不存在');
  }
  const weight = flagWeight(actor.trustLevel);

  try {
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(flags)
        .values({
          subjectType: subjectType.data,
          subjectId: rawSubjectId,
          reporterId: actor.id,
          reasonCode: reason.data,
          note: note.data.length > 0 ? note.data : null,
          weight,
          sectionId: subject.sectionId,
        })
        // 同一用户对同一内容重复举报：静默忽略（不报错，避免暴露已举报状态）
        .onConflictDoNothing()
        .returning({ id: flags.id });
      if (inserted.length === 0) {
        return;
      }

      // 聚合到 flag 队列（一条内容一项），priority = 累计权重
      const totalWeightRows = await tx
        .select({ w: sql<number>`coalesce(sum(${flags.weight}), 0)` })
        .from(flags)
        .where(
          and(
            eq(flags.subjectType, subjectType.data),
            eq(flags.subjectId, rawSubjectId),
            eq(flags.status, 'open'),
          ),
        );
      const totalWeight = Number(totalWeightRows[0]?.w ?? 0);

      await tx
        .insert(reviewItems)
        .values({
          queue: 'flag',
          subjectType: subjectType.data,
          subjectId: rawSubjectId,
          sectionId: subject.sectionId,
          priority: totalWeight,
        })
        .onConflictDoUpdate({
          target: [reviewItems.queue, reviewItems.subjectType, reviewItems.subjectId],
          set: { priority: totalWeight, status: 'pending' },
        });

      // 累计权重越线：自动隐藏评论（待复核）。文档不自动下线，仅进队列人工处理。
      if (subjectType.data === 'comment' && totalWeight >= AUTO_HIDE_WEIGHT) {
        await tx
          .update(comments)
          .set({ status: 'hidden', hiddenReason: '举报权重达阈值，自动隐藏待复核' })
          .where(and(eq(comments.id, rawSubjectId), eq(comments.status, 'visible')));
      }

      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'flag.create',
        subjectType: subjectType.data,
        subjectId: rawSubjectId,
        sectionId: subject.sectionId,
        detail: { reasonCode: reason.data, weight },
      });
    });
    return { ok: true, data: null };
  } catch {
    return fail('举报提交失败，请稍后重试');
  }
}

/** 裁决举报：uphold（采纳→隐藏内容、举报人命中）或 dismiss（驳回→举报人未命中）。 */
export async function resolveFlag(
  rawSubjectType: string,
  rawSubjectId: string,
  rawAction: string,
  rawNote: string,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session) {
    return fail('请先登录');
  }
  const actor = await loadActor(session.user.id);
  if (!actor) {
    return fail('账号状态异常，请重新登录');
  }
  const subjectType = subjectTypeSchema.safeParse(rawSubjectType);
  if (!subjectType.success || !uuidSchema.safeParse(rawSubjectId).success) {
    return fail('举报对象非法');
  }
  const action = z.enum(['uphold', 'dismiss']).safeParse(rawAction);
  if (!action.success) {
    return fail('裁决动作非法');
  }
  const note = noteSchema.safeParse(rawNote);
  if (!note.success) {
    return fail(note.error.issues[0]?.message ?? '说明校验失败');
  }

  const db = getDb();
  const subject = await resolveSubject(db, subjectType.data, rawSubjectId);
  if (subject === null) {
    return fail('内容不存在');
  }
  // flag.review 是 section_mod+ 能力（板块域）
  const decision = can(actor, 'flag.review', { sectionId: subject.sectionId });
  if (!decision.allow) {
    return fail(explainDeny(decision.reason));
  }

  const upheld = action.data === 'uphold';
  try {
    await db.transaction(async (tx) => {
      const now = new Date();
      await tx
        .update(flags)
        .set({ status: upheld ? 'upheld' : 'dismissed', resolvedBy: actor.id, resolvedAt: now })
        .where(
          and(
            eq(flags.subjectType, subjectType.data),
            eq(flags.subjectId, rawSubjectId),
            eq(flags.status, 'open'),
          ),
        );
      // 采纳：隐藏评论（文档仅留痕，下线走专门动作）
      if (upheld && subjectType.data === 'comment') {
        await tx
          .update(comments)
          .set({ status: 'hidden', hiddenBy: actor.id, hiddenReason: note.data || '举报属实' })
          .where(eq(comments.id, rawSubjectId));
      }
      // 驳回：若内容曾被自动隐藏，恢复可见
      if (!upheld && subjectType.data === 'comment') {
        await tx
          .update(comments)
          .set({ status: 'visible', hiddenBy: null, hiddenReason: null })
          .where(and(eq(comments.id, rawSubjectId), eq(comments.status, 'hidden')));
      }
      // 关闭队列项
      await tx
        .update(reviewItems)
        .set({ status: 'done', claimedBy: actor.id })
        .where(
          and(
            eq(reviewItems.queue, 'flag'),
            eq(reviewItems.subjectType, subjectType.data),
            eq(reviewItems.subjectId, rawSubjectId),
          ),
        );
      const items = await tx
        .select({ id: reviewItems.id })
        .from(reviewItems)
        .where(
          and(
            eq(reviewItems.queue, 'flag'),
            eq(reviewItems.subjectType, subjectType.data),
            eq(reviewItems.subjectId, rawSubjectId),
          ),
        )
        .limit(1);
      const itemId = items[0]?.id;
      if (itemId !== undefined) {
        await tx.insert(reviewActions).values({
          reviewItemId: itemId,
          reviewerId: actor.id,
          action: upheld ? 'uphold' : 'dismiss',
          note: note.data.length > 0 ? note.data : null,
        });
      }
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: upheld ? 'flag.uphold' : 'flag.dismiss',
        subjectType: subjectType.data,
        subjectId: rawSubjectId,
        sectionId: subject.sectionId,
        detail: { note: note.data },
      });
    });
    return { ok: true, data: null };
  } catch {
    return fail('裁决失败，请稍后重试');
  }
}
