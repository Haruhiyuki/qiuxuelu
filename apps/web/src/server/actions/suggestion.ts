'use server';

// 编辑建议 = 真实修订分支（ADR-0004）。createSuggestion 基于当前发布修订建一条 suggestion/<id> 分支：
// 新修订 parent=base、suggestion_id 标记分支（不进主线历史、不动 published）；补丁 = diff(base, head)。
import { randomUUID } from 'node:crypto';
import {
  auditLog,
  blobs,
  blocks,
  documentRefs,
  documents,
  getDb,
  hashManifest,
  publishedSnapshots,
  reviewItems,
  revisionBlocks,
  revisionChanges,
  revisions,
  searchOutbox,
  suggestions,
  toDbBlockId,
} from '@harublog/db';
import {
  can,
  canActOnSuggestion,
  explainDeny,
  type SuggestionStatus,
  transitionSuggestion,
} from '@harublog/domain';
import type { BlockNode, DocJson, ManifestEntry } from '@harublog/kernel';
import {
  buildManifest,
  CANON_VERSION,
  canonicalize,
  diffManifests,
  extractText,
  SCHEMA_VERSION,
  threeWayMerge,
  validateDoc,
} from '@harublog/kernel';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { REJECT_REASON_CODES } from '@/lib/review-reasons';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';
import { loadActor } from '@/server/actors';
import { consentGate } from '@/server/consent';
import {
  applyResolutions,
  type ConflictResolutions,
  type ConflictView,
  entriesOf,
} from '@/server/merge';
import { insertNotification } from '@/server/notifications';
import { maybeAutoPromote } from '@/server/promote';
import { notifyQueueReviewers } from '@/server/review-notify';
import { loadRevisionDoc } from '@/server/revision-doc';
import { emitTrustEvent, recomputeTrust } from '@/server/trust';

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const uuidSchema = z.uuid();
const noteSchema = z.string().trim().max(500, '建议说明最长 500 字');

interface ChangeRow {
  revisionId: string;
  blockId: string;
  change: 'add' | 'modify' | 'remove' | 'move';
  oldBlobHash?: string;
  newBlobHash?: string;
  oldPos?: number;
  newPos?: number;
}
function toChangeRow(revisionId: string, c: ReturnType<typeof diffManifests>[number]): ChangeRow {
  switch (c.kind) {
    case 'add':
      return { revisionId, blockId: c.blockId, change: 'add', newBlobHash: c.hash, newPos: c.pos };
    case 'remove':
      return {
        revisionId,
        blockId: c.blockId,
        change: 'remove',
        oldBlobHash: c.oldHash,
        oldPos: c.oldPos,
      };
    case 'modify':
      return {
        revisionId,
        blockId: c.blockId,
        change: 'modify',
        oldBlobHash: c.oldHash,
        newBlobHash: c.newHash,
        oldPos: c.oldPos,
        newPos: c.pos,
      };
    case 'move':
      return {
        revisionId,
        blockId: c.blockId,
        change: 'move',
        oldBlobHash: c.hash,
        newBlobHash: c.hash,
        oldPos: c.oldPos,
        newPos: c.pos,
      };
    default: {
      const exhausted: never = c;
      return exhausted;
    }
  }
}

export async function createSuggestion(
  rawDocId: string,
  contentJson: unknown,
  rawNote: string,
): Promise<ActionResult<{ suggestionId: string }>> {
  const session = await getSession();
  if (!session) {
    return fail('请先登录后再提交建议');
  }
  const actor = await loadActor(session.user.id);
  if (!actor) {
    return fail('账号状态异常，请重新登录');
  }
  const consentError = await consentGate(actor.id);
  if (consentError) {
    return fail(consentError);
  }
  if (!uuidSchema.safeParse(rawDocId).success) {
    return fail('文档参数非法');
  }
  const note = noteSchema.safeParse(rawNote);
  if (!note.success) {
    return fail(note.error.issues[0]?.message ?? '建议说明校验失败');
  }

  const db = getDb();
  const docRows = await db
    .select({
      id: documents.id,
      sectionId: documents.sectionId,
      status: documents.status,
      ownerId: documents.ownerId,
      slug: documents.slug,
      title: documents.title,
    })
    .from(documents)
    .where(eq(documents.id, rawDocId))
    .limit(1);
  const doc = docRows[0];
  if (doc?.status !== 'published') {
    return fail('只能对已发布的博客提交编辑建议');
  }
  if (doc.ownerId === actor.id) {
    return fail('作者请直接编辑自己的博客，无需提建议');
  }
  const decision = can(actor, 'suggestion.create', { sectionId: doc.sectionId });
  if (!decision.allow) {
    return fail(explainDeny(decision.reason));
  }

  let validated: DocJson;
  try {
    validated = validateDoc(contentJson);
  } catch (err) {
    return fail(err instanceof Error ? err.message : '内容校验失败');
  }

  try {
    const suggestionId = randomUUID();
    await db.transaction(async (tx) => {
      const manifest = buildManifest(validated);
      const dbEntries: ManifestEntry[] = [];
      const nodeByDbId = new Map<string, BlockNode>();
      validated.content.forEach((node, i) => {
        const entry = manifest.entries[i];
        if (!entry) {
          return;
        }
        const dbId = toDbBlockId(rawDocId, entry.blockId);
        if (nodeByDbId.has(dbId)) {
          throw new Error('块身份冲突');
        }
        nodeByDbId.set(dbId, node);
        dbEntries.push({ blockId: dbId, hash: entry.hash });
      });

      // base = 当前发布修订
      const refRows = await tx
        .select({ revisionId: documentRefs.revisionId })
        .from(documentRefs)
        .where(and(eq(documentRefs.documentId, rawDocId), eq(documentRefs.name, 'published')))
        .limit(1);
      const baseRevisionId = refRows[0]?.revisionId;
      if (baseRevisionId === undefined) {
        throw new Error('博客没有发布修订');
      }
      const baseRows = await tx
        .select({ blockId: revisionBlocks.blockId, hash: revisionBlocks.blobHash })
        .from(revisionBlocks)
        .where(eq(revisionBlocks.revisionId, baseRevisionId))
        .orderBy(asc(revisionBlocks.position));
      const baseEntries: ManifestEntry[] = baseRows.map((r) => ({
        blockId: r.blockId,
        hash: r.hash,
      }));
      const baseHashes = new Set(baseRows.map((r) => r.hash));

      const changes = diffManifests(baseEntries, dbEntries);
      if (changes.length === 0) {
        throw new Error('EMPTY');
      }

      const textByHash = new Map<string, string>();
      for (const [hash, node] of manifest.blobs) {
        textByHash.set(hash, extractText(node));
      }
      const blobRows = [...manifest.blobs]
        .filter(([hash]) => !baseHashes.has(hash))
        .map(([hash, node]) => ({
          hash,
          canonVersion: CANON_VERSION,
          schemaVersion: SCHEMA_VERSION,
          content: node,
          textPlain: textByHash.get(hash) ?? '',
          sizeBytes: Buffer.byteLength(canonicalize(node), 'utf8'),
        }));
      if (blobRows.length > 0) {
        await tx.insert(blobs).values(blobRows).onConflictDoNothing({ target: blobs.hash });
      }

      const maxSeqRows = await tx
        .select({ maxSeq: sql<number>`coalesce(max(${revisions.seq}), 0)` })
        .from(revisions)
        .where(eq(revisions.documentId, rawDocId));
      const newSeq = Number(maxSeqRows[0]?.maxSeq ?? 0) + 1;

      const revInserted = await tx
        .insert(revisions)
        .values({
          documentId: rawDocId,
          seq: newSeq,
          parentId: baseRevisionId,
          authorId: actor.id,
          committerId: actor.id,
          kind: 'edit',
          message: note.data.length > 0 ? note.data : null,
          manifestHash: hashManifest(dbEntries),
          schemaVersion: SCHEMA_VERSION,
          blocksChanged: changes.length,
          suggestionId, // 标记为建议分支修订（不进主线历史）
        })
        .returning({ id: revisions.id });
      const headRevisionId = revInserted[0]?.id;
      if (headRevisionId === undefined) {
        throw new Error('建议修订写入失败');
      }

      const addedIds = changes.filter((c) => c.kind === 'add').map((c) => c.blockId);
      if (addedIds.length > 0) {
        await tx
          .insert(blocks)
          .values(
            addedIds.map((id) => ({
              id,
              documentId: rawDocId,
              type: nodeByDbId.get(id)?.type ?? 'paragraph',
              bornRevisionId: headRevisionId,
            })),
          )
          .onConflictDoNothing({ target: blocks.id });
      }
      // 跨文档块身份劫持防线
      const owned = await tx
        .select({ id: blocks.id, documentId: blocks.documentId })
        .from(blocks)
        .where(
          inArray(
            blocks.id,
            dbEntries.map((e) => e.blockId),
          ),
        );
      const ownedById = new Map(owned.map((b) => [b.id, b.documentId]));
      for (const entry of dbEntries) {
        if (ownedById.get(entry.blockId) !== rawDocId) {
          throw new Error('块身份校验失败');
        }
      }
      await tx.insert(revisionBlocks).values(
        dbEntries.map((entry, position) => ({
          revisionId: headRevisionId,
          position,
          blockId: entry.blockId,
          blobHash: entry.hash,
        })),
      );
      await tx.insert(revisionChanges).values(changes.map((c) => toChangeRow(headRevisionId, c)));

      // 建议分支 ref（不动 draft/published）
      await tx.insert(documentRefs).values({
        documentId: rawDocId,
        name: `suggestion/${suggestionId}`,
        revisionId: headRevisionId,
      });
      await tx.insert(suggestions).values({
        id: suggestionId,
        documentId: rawDocId,
        authorId: actor.id,
        baseRevisionId,
        headRevisionId,
        status: 'open',
        note: note.data.length > 0 ? note.data : null,
      });
      await tx
        .insert(reviewItems)
        .values({
          queue: 'suggestion',
          subjectType: 'suggestion',
          subjectId: suggestionId,
          sectionId: doc.sectionId,
        })
        .onConflictDoNothing();
      await notifyQueueReviewers(tx, {
        queue: 'suggestion',
        sectionId: doc.sectionId,
        actorId: actor.id,
        payload: { queue: 'suggestion', title: doc.title },
      });
      await insertNotification(tx, {
        recipientId: doc.ownerId,
        actorId: actor.id,
        kind: 'suggestion_received',
        payload: {
          docId: rawDocId,
          slug: doc.slug,
          title: doc.title,
          suggestionId,
          byName: session.user.name,
        },
      });
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'suggestion.create',
        subjectType: 'suggestion',
        subjectId: suggestionId,
        sectionId: doc.sectionId,
        detail: { documentId: rawDocId, blocksChanged: changes.length },
      });
    });
    // 建议是「他人贡献」的核心：建议落库后检查是否够阈值自动转公共（ADR-0007）
    await maybeAutoPromote(db, rawDocId);
    return { ok: true, data: { suggestionId } };
  } catch (err) {
    if (err instanceof Error && err.message === 'EMPTY') {
      return fail('建议未做任何修改');
    }
    return fail('提交建议失败，请稍后重试');
  }
}

// ── 审校与撤回（合并见 mergeSuggestion，单列于步骤③）──────────────────────────

interface SgRow {
  id: string;
  documentId: string;
  authorId: string | null;
  status: string;
  sectionId: string;
  ownerId: string | null;
  slug: string;
  title: string;
  visibility: string;
}

async function loadSuggestion(
  db: ReturnType<typeof getDb>,
  suggestionId: string,
): Promise<SgRow | undefined> {
  const rows = await db
    .select({
      id: suggestions.id,
      documentId: suggestions.documentId,
      authorId: suggestions.authorId,
      status: suggestions.status,
      sectionId: documents.sectionId,
      ownerId: documents.ownerId,
      slug: documents.slug,
      title: documents.title,
      visibility: documents.visibility,
    })
    .from(suggestions)
    .innerJoin(documents, eq(documents.id, suggestions.documentId))
    .where(eq(suggestions.id, suggestionId))
    .limit(1);
  return rows[0];
}

/** 审校者准入：can('suggestion.review')（含作者审自己博客的建议——owner 自 TL0 起，ADR-0008）。 */
function reviewDecision(actor: Parameters<typeof can>[0], sg: SgRow) {
  return can(actor, 'suggestion.review', {
    sectionId: sg.sectionId,
    doc: {
      id: sg.documentId,
      ownerId: sg.ownerId ?? '',
      editPolicy: 'open',
      status: 'published',
      visibility: sg.visibility as 'private' | 'public',
    },
  });
}

/** 活跃态 open 先自动 claim 到 under_review，再执行审校动作（M3 不单设认领 UI）。 */
function toUnderReview(status: string): SuggestionStatus {
  return status === 'open' ? transitionSuggestion('open', 'claim') : (status as SuggestionStatus);
}

export async function requestSuggestionChanges(
  rawId: string,
  rawNote: string,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return fail('请先登录');
  const actor = await loadActor(session.user.id);
  if (!actor || !uuidSchema.safeParse(rawId).success) return fail('参数非法');
  const note = noteSchema.safeParse(rawNote);
  if (!note.success) return fail(note.error.issues[0]?.message ?? '说明校验失败');

  const db = getDb();
  const sg = await loadSuggestion(db, rawId);
  if (!sg) return fail('建议不存在');
  const decision = reviewDecision(actor, sg);
  if (!decision.allow) return fail(explainDeny(decision.reason));
  const isAuthor = sg.authorId === actor.id;
  if (!canActOnSuggestion('request_changes', { isAuthor, isReviewer: true })) {
    return fail('不能裁决自己提交的建议');
  }

  try {
    await db.transaction(async (tx) => {
      const next = transitionSuggestion(toUnderReview(sg.status), 'request_changes');
      const updated = await tx
        .update(suggestions)
        .set({ status: next })
        .where(
          and(eq(suggestions.id, rawId), inArray(suggestions.status, ['open', 'under_review'])),
        )
        .returning({ id: suggestions.id });
      if (updated.length === 0) throw new Error('该建议已被处理');
      await insertNotification(tx, {
        recipientId: sg.authorId,
        actorId: actor.id,
        kind: 'suggestion_changes',
        payload: { docId: sg.documentId, slug: sg.slug, title: sg.title, suggestionId: rawId },
      });
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'suggestion.request_changes',
        subjectType: 'suggestion',
        subjectId: rawId,
        sectionId: sg.sectionId,
        detail: { note: note.data },
      });
    });
    return { ok: true, data: null };
  } catch {
    return fail('操作失败，请稍后重试');
  }
}

export async function rejectSuggestion(
  rawId: string,
  rawReasonCode: string,
  rawNote: string,
): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return fail('请先登录');
  const actor = await loadActor(session.user.id);
  if (!actor || !uuidSchema.safeParse(rawId).success) return fail('参数非法');
  const reason = z.enum(REJECT_REASON_CODES).safeParse(rawReasonCode);
  if (!reason.success) return fail('请选择驳回理由');
  const note = noteSchema.safeParse(rawNote);
  if (!note.success) return fail(note.error.issues[0]?.message ?? '说明校验失败');

  const db = getDb();
  const sg = await loadSuggestion(db, rawId);
  if (!sg) return fail('建议不存在');
  const decision = reviewDecision(actor, sg);
  if (!decision.allow) return fail(explainDeny(decision.reason));
  const isAuthor = sg.authorId === actor.id;
  if (!canActOnSuggestion('reject', { isAuthor, isReviewer: true })) {
    return fail('不能裁决自己提交的建议');
  }

  try {
    await db.transaction(async (tx) => {
      const next = transitionSuggestion(toUnderReview(sg.status), 'reject');
      const now = new Date();
      const updated = await tx
        .update(suggestions)
        .set({ status: next, resolvedBy: actor.id, resolvedAt: now })
        .where(
          and(eq(suggestions.id, rawId), inArray(suggestions.status, ['open', 'under_review'])),
        )
        .returning({ id: suggestions.id });
      if (updated.length === 0) throw new Error('该建议已被处理');
      // 信任：被拒减分（喂 mergeRejectRatio 窗口）+ 重算作者
      if (sg.authorId !== null) {
        await emitTrustEvent(tx, {
          userId: sg.authorId,
          kind: 'suggestion_rejected',
          refType: 'suggestion',
          refId: rawId,
        });
        await recomputeTrust(tx, sg.authorId, now);
      }
      await insertNotification(tx, {
        recipientId: sg.authorId,
        actorId: actor.id,
        kind: 'suggestion_rejected',
        payload: { docId: sg.documentId, slug: sg.slug, title: sg.title, suggestionId: rawId },
      });
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'suggestion.reject',
        subjectType: 'suggestion',
        subjectId: rawId,
        sectionId: sg.sectionId,
        detail: { reasonCode: reason.data, note: note.data },
      });
      await closeQueue(tx, rawId);
    });
    return { ok: true, data: null };
  } catch {
    return fail('驳回失败，请稍后重试');
  }
}

export async function withdrawSuggestion(rawId: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return fail('请先登录');
  const actor = await loadActor(session.user.id);
  if (!actor || !uuidSchema.safeParse(rawId).success) return fail('参数非法');

  const db = getDb();
  const sg = await loadSuggestion(db, rawId);
  if (!sg) return fail('建议不存在');
  if (sg.authorId !== actor.id) return fail('只有建议作者本人可以撤回');

  try {
    await db.transaction(async (tx) => {
      const next = transitionSuggestion(sg.status as SuggestionStatus, 'withdraw');
      const updated = await tx
        .update(suggestions)
        .set({ status: next, resolvedBy: actor.id, resolvedAt: new Date() })
        .where(
          and(
            eq(suggestions.id, rawId),
            inArray(suggestions.status, ['open', 'under_review', 'changes_requested', 'outdated']),
          ),
        )
        .returning({ id: suggestions.id });
      if (updated.length === 0) throw new Error('该建议已被处理');
      await closeQueue(tx, rawId);
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'suggestion.withdraw',
        subjectType: 'suggestion',
        subjectId: rawId,
        sectionId: sg.sectionId,
        detail: {},
      });
    });
    return { ok: true, data: null };
  } catch {
    return fail('撤回失败，请稍后重试');
  }
}

/** 关闭建议的审校队列项（裁决/撤回/合并后统一调用）。 */
async function closeQueue(
  tx: { update: ReturnType<typeof getDb>['update'] },
  suggestionId: string,
) {
  await tx
    .update(reviewItems)
    .set({ status: 'done' })
    .where(
      and(
        eq(reviewItems.queue, 'suggestion'),
        eq(reviewItems.subjectType, 'suggestion'),
        eq(reviewItems.subjectId, suggestionId),
      ),
    );
}

// ── 接受建议：三方块级合并（快进/自动变基/冲突裁决，ADR-0004 §3.3）──────────────

/** 冲突裁决结果：blockId → 采用主线(ours)还是建议(theirs)。 */
// ConflictResolutions / ConflictView / applyResolutions / entriesOf 已抽到 @/server/merge（与直接提交共用）
export type { ConflictResolutions, ConflictView };

export type MergeOutcome =
  | { merged: true; seq: number }
  | { merged: false; conflicts: ConflictView[] };

export async function mergeSuggestion(
  rawId: string,
  resolutions: ConflictResolutions = {},
): Promise<ActionResult<MergeOutcome>> {
  const session = await getSession();
  if (!session) return fail('请先登录');
  const actor = await loadActor(session.user.id);
  if (!actor || !uuidSchema.safeParse(rawId).success) return fail('参数非法');

  const db = getDb();
  const sgRows = await db
    .select({
      id: suggestions.id,
      documentId: suggestions.documentId,
      authorId: suggestions.authorId,
      baseRevisionId: suggestions.baseRevisionId,
      headRevisionId: suggestions.headRevisionId,
      status: suggestions.status,
      sectionId: documents.sectionId,
      ownerId: documents.ownerId,
      slug: documents.slug,
      title: documents.title,
      visibility: documents.visibility,
    })
    .from(suggestions)
    .innerJoin(documents, eq(documents.id, suggestions.documentId))
    .where(eq(suggestions.id, rawId))
    .limit(1);
  const sg = sgRows[0];
  if (!sg) return fail('建议不存在');
  // outdated 也可合入（即三栏变基后落盘）
  if (!['open', 'under_review', 'changes_requested', 'outdated'].includes(sg.status)) {
    return fail('该建议已结案，无法合入');
  }
  const decision = can(actor, 'suggestion.merge', {
    sectionId: sg.sectionId,
    doc: {
      id: sg.documentId,
      ownerId: sg.ownerId ?? '',
      editPolicy: 'open',
      status: 'published',
      visibility: sg.visibility as 'private' | 'public',
    },
  });
  if (!decision.allow) return fail(explainDeny(decision.reason));
  if (!canActOnSuggestion('merge', { isAuthor: sg.authorId === actor.id, isReviewer: true })) {
    return fail('不能合入自己提交的建议');
  }

  try {
    const outcome = await db.transaction(async (tx): Promise<MergeOutcome> => {
      // 三方：base=建议基底、ours=当前发布修订（主线）、theirs=建议头
      const pubRows = await tx
        .select({ revisionId: documentRefs.revisionId })
        .from(documentRefs)
        .where(and(eq(documentRefs.documentId, sg.documentId), eq(documentRefs.name, 'published')))
        .limit(1);
      const oursHead = pubRows[0]?.revisionId;
      if (oursHead === undefined) throw new Error('博客无发布修订');

      const [baseEntries, oursEntries, theirsEntries] = await Promise.all([
        entriesOf(tx, sg.baseRevisionId),
        entriesOf(tx, oursHead),
        entriesOf(tx, sg.headRevisionId),
      ]);

      const merge = threeWayMerge(baseEntries, oursEntries, theirsEntries);
      const unresolved = merge.conflicts.filter((c) => resolutions[c.blockId] === undefined);
      if (unresolved.length > 0) {
        // 存在未裁决冲突：不写入内容，把建议标记为 outdated（提示需逐块裁决/变基），回传冲突清单
        if (sg.status !== 'outdated') {
          await tx.update(suggestions).set({ status: 'outdated' }).where(eq(suggestions.id, rawId));
        }
        return {
          merged: false,
          conflicts: merge.conflicts.map((c) => ({
            blockId: c.blockId,
            baseHash: c.baseHash,
            oursHash: c.oursHash,
            theirsHash: c.theirsHash,
          })),
        };
      }
      const finalEntries = applyResolutions(merge.entries, merge.conflicts, resolutions);

      const changes = diffManifests(oursEntries, finalEntries);
      if (changes.length === 0) {
        // 主线已包含该建议的全部改动（殊途同归），直接结案为已合入
        await tx
          .update(suggestions)
          .set({
            status: 'merged',
            resolvedBy: actor.id,
            resolvedAt: new Date(),
            mergedRevisionId: oursHead,
          })
          .where(eq(suggestions.id, rawId));
        await closeQueue(tx, rawId);
        return { merged: true, seq: 0 };
      }

      const maxSeqRows = await tx
        .select({ maxSeq: sql<number>`coalesce(max(${revisions.seq}), 0)` })
        .from(revisions)
        .where(eq(revisions.documentId, sg.documentId));
      const newSeq = Number(maxSeqRows[0]?.maxSeq ?? 0) + 1;
      const baseSchema = await tx
        .select({ schemaVersion: revisions.schemaVersion })
        .from(revisions)
        .where(eq(revisions.id, oursHead))
        .limit(1);

      const merged = await tx
        .insert(revisions)
        .values({
          documentId: sg.documentId,
          seq: newSeq,
          parentId: oursHead, // 主线父
          mergeParentId: sg.headRevisionId, // 第二父=建议头
          authorId: sg.authorId, // 内容作者=建议人
          committerId: actor.id, // 落盘者=审校者（双署名）
          kind: 'merge_suggestion',
          message: '合入编辑建议',
          manifestHash: hashManifest(finalEntries),
          schemaVersion: baseSchema[0]?.schemaVersion ?? SCHEMA_VERSION,
          blocksChanged: changes.length,
          // suggestionId 留空：merge commit 在主线
        })
        .returning({ id: revisions.id });
      const mergeRevId = merged[0]?.id;
      if (mergeRevId === undefined) throw new Error('合并修订写入失败');

      await tx.insert(revisionBlocks).values(
        finalEntries.map((e, position) => ({
          revisionId: mergeRevId,
          position,
          blockId: e.blockId,
          blobHash: e.hash,
        })),
      );
      await tx.insert(revisionChanges).values(changes.map((c) => toChangeRow(mergeRevId, c)));

      // CAS 移 published（expected = 合并所基于的主线头）
      const now = new Date();
      const moved = await tx
        .update(documentRefs)
        .set({ revisionId: mergeRevId, updatedAt: now })
        .where(
          and(
            eq(documentRefs.documentId, sg.documentId),
            eq(documentRefs.name, 'published'),
            eq(documentRefs.revisionId, oursHead),
          ),
        )
        .returning({ documentId: documentRefs.documentId });
      if (moved.length === 0) throw new Error('合并冲突：主线在合入期间已更新，请重试');

      const assembled = await loadRevisionDoc(tx, mergeRevId);
      const snapshot = validateDoc(assembled);
      await tx
        .update(publishedSnapshots)
        .set({ revisionId: mergeRevId, content: snapshot, publishedAt: now })
        .where(eq(publishedSnapshots.documentId, sg.documentId));
      await tx.update(documents).set({ updatedAt: now }).where(eq(documents.id, sg.documentId));
      await tx
        .insert(searchOutbox)
        .values({ topic: 'doc.published', payload: { docId: sg.documentId } });

      await tx
        .update(suggestions)
        .set({
          status: 'merged',
          resolvedBy: actor.id,
          resolvedAt: now,
          mergedRevisionId: mergeRevId,
        })
        .where(eq(suggestions.id, rawId));
      await closeQueue(tx, rawId);

      // 信任：建议被合入（核心晋升指标）+ 重算作者
      if (sg.authorId !== null) {
        await emitTrustEvent(tx, {
          userId: sg.authorId,
          kind: 'suggestion_merged',
          refType: 'suggestion',
          refId: rawId,
        });
        await recomputeTrust(tx, sg.authorId, now);
        await insertNotification(tx, {
          recipientId: sg.authorId,
          actorId: actor.id,
          kind: 'suggestion_merged',
          payload: { docId: sg.documentId, slug: sg.slug, title: sg.title, suggestionId: rawId },
        });
      }
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'suggestion.merge',
        subjectType: 'suggestion',
        subjectId: rawId,
        sectionId: sg.sectionId,
        detail: {
          documentId: sg.documentId,
          mergeRevisionId: mergeRevId,
          fastForward: merge.fastForward,
        },
      });
      return { merged: true, seq: newSeq };
    });
    // 合入新增一条非作者署名的主线修订（他人贡献）：检查是否够阈值自动转公共（ADR-0007）
    await maybeAutoPromote(db, sg.documentId);
    return { ok: true, data: outcome };
  } catch (err) {
    return fail(err instanceof Error ? err.message : '合入失败，请稍后重试');
  }
}
