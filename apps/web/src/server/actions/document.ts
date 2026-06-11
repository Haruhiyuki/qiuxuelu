'use server';

// 文档写路径四动作：创建 / 保存工作副本 / 提交修订（核心链路）/ 申请发布。
// 纪律：鉴权一律经 domain can()；状态迁移一律经 domain transition()；
// 修订写入全程单事务 + CAS 移 ref，绝不静默覆盖（架构 §3.2）。
import {
  auditLog,
  blobs,
  blocks,
  documentRefs,
  documents,
  getDb,
  hashManifest,
  publishedSnapshots,
  publishRequests,
  reviewItems,
  revisionBlocks,
  revisionChanges,
  revisions,
  searchOutbox,
  sections,
  toDbBlockId,
  workingCopies,
} from '@harublog/db';
import type { DocCtx } from '@harublog/domain';
import { can, explainDeny, WorkflowError } from '@harublog/domain';
import type { BlockNode, DocJson, ManifestEntry } from '@harublog/kernel';
import {
  buildManifest,
  CANON_VERSION,
  canonicalize,
  diffManifests,
  extractText,
  SCHEMA_VERSION,
  validateDoc,
} from '@harublog/kernel';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { docStatusLabel } from '@/lib/doc-labels';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';
import { loadActor } from '@/server/actors';
import { consentGate } from '@/server/consent';
import { insertNotification } from '@/server/notifications';
import { loadRevisionDoc } from '@/server/revision-doc';

/** 业务可预期失败：事务内抛出触发回滚，边界处转成 {ok:false} 中文文案。 */
class ActionError extends Error {}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** 唯一约束冲突判别：drizzle 包装驱动错误，code 在 cause 链深处，必须逐层下钻。 */
function isUniqueViolation(err: unknown): boolean {
  for (let e = err; typeof e === 'object' && e !== null; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: string }).code === '23505') {
      return true;
    }
  }
  return false;
}

function toFailure(err: unknown, fallback: string): { ok: false; error: string } {
  if (err instanceof ActionError || err instanceof WorkflowError) {
    return fail(err.message);
  }
  return fail(fallback);
}

interface DocRow {
  id: string;
  sectionId: string;
  ownerId: string | null;
  editPolicy: string;
  status: string;
  slug: string;
  title: string;
}

function toDocCtx(row: DocRow): DocCtx {
  return {
    id: row.id,
    ownerId: row.ownerId ?? '',
    editPolicy: row.editPolicy as DocCtx['editPolicy'],
    // db 比 domain 多一个 'pending'（审批中）状态，对鉴权语义等同草稿期
    status: (row.status === 'pending' ? 'draft' : row.status) as DocCtx['status'],
  };
}

async function requireActor() {
  const session = await getSession();
  if (!session) {
    return null;
  }
  return loadActor(session.user.id);
}

async function findDoc(docId: string): Promise<DocRow | undefined> {
  const db = getDb();
  const rows = await db
    .select({
      id: documents.id,
      sectionId: documents.sectionId,
      ownerId: documents.ownerId,
      editPolicy: documents.editPolicy,
      status: documents.status,
      slug: documents.slug,
      title: documents.title,
    })
    .from(documents)
    .where(eq(documents.id, docId))
    .limit(1);
  return rows[0];
}

const titleSchema = z.string().trim().min(1, '标题不能为空').max(120, '标题最长 120 字');
const uuidSchema = z.uuid();

interface ChangeRow {
  revisionId: string;
  blockId: string;
  change: 'add' | 'modify' | 'remove' | 'move';
  oldBlobHash?: string;
  newBlobHash?: string;
  oldPos?: number;
  newPos?: number;
}

/** kernel BlockChange → revision_changes 行（块级 blame 的物化来源）。 */
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

export async function createDocument(
  rawTitle: string,
  rawSectionId: string,
): Promise<ActionResult<{ docId: string }>> {
  const actor = await requireActor();
  if (!actor) {
    return fail('请先登录');
  }
  const consentError = await consentGate(actor.id);
  if (consentError) {
    return fail(consentError);
  }
  const title = titleSchema.safeParse(rawTitle);
  if (!title.success) {
    return fail(title.error.issues[0]?.message ?? '标题校验失败');
  }
  if (!uuidSchema.safeParse(rawSectionId).success) {
    return fail('板块参数非法');
  }

  // 携带板块上下文：否则板块域的 no_edit/suspend 制裁会被绕过（fail-open）
  const decision = can(actor, 'doc.create', { sectionId: rawSectionId });
  if (!decision.allow) {
    return fail(explainDeny(decision.reason));
  }

  const db = getDb();
  const sectionRows = await db
    .select({ id: sections.id })
    .from(sections)
    .where(eq(sections.id, rawSectionId))
    .limit(1);
  if (!sectionRows[0]) {
    return fail('所选板块不存在');
  }

  try {
    const docId = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(documents)
        .values({
          sectionId: rawSectionId,
          // nanoid(10) 碰撞概率可忽略；万一撞 unique 由外层兜底提示重试
          slug: nanoid(10),
          title: title.data,
          ownerId: actor.id,
          status: 'draft',
          schemaVersion: SCHEMA_VERSION,
        })
        .returning({ id: documents.id });
      const doc = inserted[0];
      if (!doc) {
        throw new ActionError('文章创建失败，请稍后重试');
      }
      await tx.insert(workingCopies).values({
        documentId: doc.id,
        userId: actor.id,
        content: { type: 'doc', content: [] },
      });
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'doc.create',
        subjectType: 'document',
        subjectId: doc.id,
        sectionId: rawSectionId,
        detail: { title: title.data },
      });
      return doc.id;
    });
    return { ok: true, data: { docId } };
  } catch (err) {
    return toFailure(err, '文章创建失败，请稍后重试');
  }
}

export async function saveWorkingCopy(
  rawDocId: string,
  contentJson: unknown,
): Promise<ActionResult> {
  const actor = await requireActor();
  if (!actor) {
    return fail('请先登录');
  }
  if (!uuidSchema.safeParse(rawDocId).success) {
    return fail('文档参数非法');
  }
  const doc = await findDoc(rawDocId);
  if (!doc) {
    return fail('文章不存在');
  }
  if (doc.ownerId !== actor.id) {
    return fail('只有作者本人可以编辑这篇文章');
  }
  // 与 commitRevision 同闸：停用账号与 no_edit/suspend 制裁在保存阶段即一票否决，
  // 不给被制裁者留下任何服务端写路径（含私有工作副本）。
  const decision = can(actor, 'doc.edit_direct', { sectionId: doc.sectionId, doc: toDocCtx(doc) });
  if (!decision.allow) {
    return fail(explainDeny(decision.reason));
  }

  let validated: DocJson;
  try {
    validated = validateDoc(contentJson);
  } catch (err) {
    return fail(err instanceof Error ? err.message : '文档内容校验失败');
  }

  const db = getDb();
  const now = new Date();
  await db
    .insert(workingCopies)
    .values({ documentId: rawDocId, userId: actor.id, content: validated, updatedAt: now })
    .onConflictDoUpdate({
      target: [workingCopies.documentId, workingCopies.userId],
      set: { content: validated, updatedAt: now },
    });
  return { ok: true, data: null };
}

export async function commitRevision(
  rawDocId: string,
  rawMessage: string,
): Promise<ActionResult<{ seq: number }>> {
  const actor = await requireActor();
  if (!actor) {
    return fail('请先登录');
  }
  if (!uuidSchema.safeParse(rawDocId).success) {
    return fail('文档参数非法');
  }
  const messageParsed = z.string().trim().max(500, '修订说明最长 500 字').safeParse(rawMessage);
  if (!messageParsed.success) {
    return fail(messageParsed.error.issues[0]?.message ?? '修订说明校验失败');
  }
  const message = messageParsed.data.length > 0 ? messageParsed.data : null;

  const docRow = await findDoc(rawDocId);
  if (!docRow) {
    return fail('文章不存在');
  }
  if (docRow.ownerId !== actor.id) {
    return fail('只有作者本人可以提交修订（协作建议是下一阶段功能）');
  }
  // 经 can() 而非裸放行：让 edit_ban/ban 制裁与账号停用在此一票否决
  const decision = can(actor, 'doc.edit_direct', {
    sectionId: docRow.sectionId,
    doc: toDocCtx(docRow),
  });
  if (!decision.allow) {
    return fail(explainDeny(decision.reason));
  }

  const db = getDb();
  try {
    const seq = await db.transaction(async (tx) => {
      const wcRows = await tx
        .select({ content: workingCopies.content, baseRevisionId: workingCopies.baseRevisionId })
        .from(workingCopies)
        .where(and(eq(workingCopies.documentId, rawDocId), eq(workingCopies.userId, actor.id)))
        .limit(1);
      const wc = wcRows[0];
      if (!wc) {
        throw new ActionError('没有可提交的草稿内容，请先编辑并保存');
      }
      const doc = validateDoc(wc.content);
      const manifest = buildManifest(doc);

      // 编辑器侧 nanoid → 库内稳定 uuid；entries 与 doc.content 同序一一对应
      const dbEntries: ManifestEntry[] = [];
      const nodeByDbId = new Map<string, BlockNode>();
      doc.content.forEach((node, i) => {
        const entry = manifest.entries[i];
        if (!entry) {
          return;
        }
        const dbId = toDbBlockId(rawDocId, entry.blockId);
        if (nodeByDbId.has(dbId)) {
          throw new ActionError(`块身份冲突：${entry.blockId} 映射重复，请刷新页面后重试`);
        }
        nodeByDbId.set(dbId, node);
        dbEntries.push({ blockId: dbId, hash: entry.hash });
      });

      const refRows = await tx
        .select({ revisionId: documentRefs.revisionId })
        .from(documentRefs)
        .where(and(eq(documentRefs.documentId, rawDocId), eq(documentRefs.name, 'draft')))
        .limit(1);
      const expectedHead = refRows[0]?.revisionId ?? null;
      // 陈旧基底防线：草稿基于的修订落后于当前头时拒绝提交——否则会把别的会话
      // 已提交的新内容静默回退（丢更新）。刷新页面后编辑器会基于最新头重建草稿。
      if (
        wc.baseRevisionId !== null &&
        expectedHead !== null &&
        wc.baseRevisionId !== expectedHead
      ) {
        throw new ActionError(
          '草稿基于的版本已落后于最新修订（其他会话已提交过），请刷新页面核对内容后再提交',
        );
      }

      let parentEntries: ManifestEntry[] = [];
      let oldChars = 0;
      const parentHashes = new Set<string>();
      if (expectedHead !== null) {
        const parentRows = await tx
          .select({
            blockId: revisionBlocks.blockId,
            hash: revisionBlocks.blobHash,
            textLen: sql<number>`length(${blobs.textPlain})`,
          })
          .from(revisionBlocks)
          .innerJoin(blobs, eq(blobs.hash, revisionBlocks.blobHash))
          .where(eq(revisionBlocks.revisionId, expectedHead))
          .orderBy(asc(revisionBlocks.position));
        parentEntries = parentRows.map((row) => ({ blockId: row.blockId, hash: row.hash }));
        for (const row of parentRows) {
          oldChars += row.textLen;
          parentHashes.add(row.hash);
        }
      }
      // seq 是文档全局单调计数（与分支无关）——取全文档最大值 +1，避免与建议分支等占用的 seq 碰撞
      const maxSeqRows = await tx
        .select({ maxSeq: sql<number>`coalesce(max(${revisions.seq}), 0)` })
        .from(revisions)
        .where(eq(revisions.documentId, rawDocId));
      const parentSeq = Number(maxSeqRows[0]?.maxSeq ?? 0);

      const changes = diffManifests(parentEntries, dbEntries);
      if (changes.length === 0) {
        throw new ActionError('内容与当前修订完全一致，无需提交');
      }

      const textByHash = new Map<string, string>();
      for (const [hash, node] of manifest.blobs) {
        textByHash.set(hash, extractText(node));
      }
      let newChars = 0;
      for (const entry of dbEntries) {
        // 按码点计数与旧值的 SQL length()（PG 码点语义）同口径，星平面字符不偏斜
        newChars += [...(textByHash.get(entry.hash) ?? '')].length;
      }

      // 新 blob 内容寻址去重：父修订已有的哈希直接复用，跨文档重复交给 onConflictDoNothing
      const blobRows = [...manifest.blobs]
        .filter(([hash]) => !parentHashes.has(hash))
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

      const newSeq = parentSeq + 1;
      const revInserted = await tx
        .insert(revisions)
        .values({
          documentId: rawDocId,
          seq: newSeq,
          parentId: expectedHead,
          authorId: actor.id,
          committerId: actor.id,
          kind: 'edit',
          message,
          manifestHash: hashManifest(dbEntries),
          schemaVersion: SCHEMA_VERSION,
          charsDelta: newChars - oldChars,
          blocksChanged: changes.length,
        })
        .returning({ id: revisions.id });
      const revisionId = revInserted[0]?.id;
      if (revisionId === undefined) {
        throw new ActionError('修订写入失败，请稍后重试');
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
              bornRevisionId: revisionId,
            })),
          )
          // 历史上删除过又被加回的块：身份复活而非新建
          .onConflictDoNothing({ target: blocks.id });
      }

      // 跨文档块身份劫持防线：树中引用的每个块必须属于本文档。
      // uuid 形 blockId 从快照回灌路径直通入树，onConflictDoNothing 会静默吞掉
      // 「插入他文档已有块」的冲突——必须显式校验所属。
      if (dbEntries.length > 0) {
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
          const ownerDoc = ownedById.get(entry.blockId);
          if (ownerDoc === undefined || ownerDoc !== rawDocId) {
            throw new ActionError('块身份校验失败：存在不属于本文档的块引用，请刷新页面后重试');
          }
        }
      }

      if (dbEntries.length > 0)
        await tx.insert(revisionBlocks).values(
          dbEntries.map((entry, position) => ({
            revisionId,
            position,
            blockId: entry.blockId,
            blobHash: entry.hash,
          })),
        );

      await tx.insert(revisionChanges).values(changes.map((c) => toChangeRow(revisionId, c)));

      // CAS 移 draft ref：WHERE revision_id = expected，0 行即说明并发前移，整体回滚
      const now = new Date();
      if (expectedHead !== null) {
        const moved = await tx
          .update(documentRefs)
          .set({ revisionId, updatedAt: now })
          .where(
            and(
              eq(documentRefs.documentId, rawDocId),
              eq(documentRefs.name, 'draft'),
              eq(documentRefs.revisionId, expectedHead),
            ),
          )
          .returning({ documentId: documentRefs.documentId });
        if (moved.length === 0) {
          throw new ActionError('提交冲突：草稿在你提交期间已被其他会话更新，请刷新页面后重试');
        }
      } else {
        const created = await tx
          .insert(documentRefs)
          .values({ documentId: rawDocId, name: 'draft', revisionId })
          .onConflictDoNothing()
          .returning({ documentId: documentRefs.documentId });
        if (created.length === 0) {
          throw new ActionError('提交冲突：首个修订已被其他会话抢先创建，请刷新页面后重试');
        }
      }

      await tx
        .update(workingCopies)
        .set({ baseRevisionId: revisionId })
        .where(and(eq(workingCopies.documentId, rawDocId), eq(workingCopies.userId, actor.id)));
      await tx.update(documents).set({ updatedAt: now }).where(eq(documents.id, rawDocId));
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'doc.commit_revision',
        subjectType: 'revision',
        subjectId: revisionId,
        sectionId: docRow.sectionId,
        detail: { documentId: rawDocId, seq: newSeq, blocksChanged: changes.length },
      });
      return newSeq;
    });
    return { ok: true, data: { seq } };
  } catch (err) {
    // 并发竞速也可能先撞 unique(document_id, seq) 而非 CAS——统一回中文冲突提示
    if (isUniqueViolation(err)) {
      return fail('提交冲突：草稿在你提交期间已被其他会话更新，请刷新页面后重试');
    }
    return toFailure(err, '提交修订失败，请稍后重试');
  }
}

export async function requestPublish(rawDocId: string): Promise<ActionResult> {
  const actor = await requireActor();
  if (!actor) {
    return fail('请先登录');
  }
  if (!uuidSchema.safeParse(rawDocId).success) {
    return fail('文档参数非法');
  }
  const docRow = await findDoc(rawDocId);
  if (!docRow) {
    return fail('文章不存在');
  }
  if (docRow.ownerId !== actor.id) {
    return fail('只有作者本人可以申请发布');
  }
  const decision = can(actor, 'doc.submit', { sectionId: docRow.sectionId, doc: toDocCtx(docRow) });
  if (!decision.allow) {
    return fail(explainDeny(decision.reason));
  }
  // draft 首发与 published 改版走同一审批循环（架构 §5）；pending/archived 不可重复申请
  if (docRow.status !== 'draft' && docRow.status !== 'published') {
    return fail(`当前状态为「${docStatusLabel(docRow.status)}」，不能申请发布`);
  }

  const db = getDb();
  try {
    await db.transaction(async (tx) => {
      const refRows = await tx
        .select({ revisionId: documentRefs.revisionId })
        .from(documentRefs)
        .where(and(eq(documentRefs.documentId, rawDocId), eq(documentRefs.name, 'draft')))
        .limit(1);
      const head = refRows[0]?.revisionId;
      if (head === undefined) {
        throw new ActionError('还没有任何已提交的修订，请先提交一次修订再申请发布');
      }
      const inserted = await tx
        .insert(publishRequests)
        .values({
          documentId: rawDocId,
          revisionId: head,
          requesterId: actor.id,
          // 「提交申请」=创建新请求行，初始即 pending（状态机不设 draft 伪状态）
          status: 'pending',
        })
        // 撞「每文档仅一个未决请求」的部分唯一索引即为重复申请
        .onConflictDoNothing()
        .returning({ id: publishRequests.id });
      const request = inserted[0];
      if (!request) {
        throw new ActionError('这篇文章已有待审的发布请求，请耐心等待审批');
      }
      await tx
        .insert(reviewItems)
        .values({
          queue: 'new_document',
          subjectType: 'publish_request',
          subjectId: request.id,
          sectionId: docRow.sectionId,
        })
        .onConflictDoNothing();
      // 已发布文章的改版申请不改变线上状态（published 不动），仅首发从 draft 进入 pending
      if (docRow.status === 'draft') {
        await tx
          .update(documents)
          .set({ status: 'pending', updatedAt: new Date() })
          .where(eq(documents.id, rawDocId));
      }
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'doc.request_publish',
        subjectType: 'publish_request',
        subjectId: request.id,
        sectionId: docRow.sectionId,
        detail: { documentId: rawDocId, revisionId: head },
      });
    });
    return { ok: true, data: null };
  } catch (err) {
    return toFailure(err, '申请发布失败，请稍后重试');
  }
}

/**
 * 回滚草稿到某历史修订（架构 §5「回退 = 创建指回旧树的新修订，历史不删」）。
 * 在草稿分支上创建一个 kind='rollback' 新修订，其树 = 目标修订的树（内容被还原），
 * 旧修订与中间修订全部保留——这是「全历史可直观追溯」的一等操作，不是删除。
 * 鉴权同提交（can('doc.edit_direct')：作者经所有权特例、编辑经角色线）。
 * 回滚后若文章已发布，线上版本不动；作者需重新申请发布才会让还原内容上线。
 */
export async function restoreRevision(
  rawDocId: string,
  rawTargetRevisionId: string,
): Promise<ActionResult<{ seq: number }>> {
  const actor = await requireActor();
  if (!actor) {
    return fail('请先登录');
  }
  if (
    !uuidSchema.safeParse(rawDocId).success ||
    !uuidSchema.safeParse(rawTargetRevisionId).success
  ) {
    return fail('参数非法');
  }
  const docRow = await findDoc(rawDocId);
  if (!docRow) {
    return fail('文章不存在');
  }
  const decision = can(actor, 'doc.edit_direct', {
    sectionId: docRow.sectionId,
    doc: toDocCtx(docRow),
  });
  if (!decision.allow) {
    return fail(explainDeny(decision.reason));
  }

  const db = getDb();
  try {
    const seq = await db.transaction(async (tx) => {
      // 目标修订必须属于本文档（防跨文档回滚）
      const targetRows = await tx
        .select({ id: revisions.id, seq: revisions.seq, schemaVersion: revisions.schemaVersion })
        .from(revisions)
        .where(and(eq(revisions.id, rawTargetRevisionId), eq(revisions.documentId, rawDocId)))
        .limit(1);
      const target = targetRows[0];
      if (!target) {
        throw new ActionError('目标修订不存在或不属于本文章');
      }

      // 目标修订的树（即将成为新修订的树，引用的 blocks/blobs 均已存在）
      const targetTree = await tx
        .select({
          position: revisionBlocks.position,
          blockId: revisionBlocks.blockId,
          blobHash: revisionBlocks.blobHash,
        })
        .from(revisionBlocks)
        .where(eq(revisionBlocks.revisionId, rawTargetRevisionId))
        .orderBy(asc(revisionBlocks.position));
      const targetEntries: ManifestEntry[] = targetTree.map((r) => ({
        blockId: r.blockId,
        hash: r.blobHash,
      }));

      // 当前草稿头
      const refRows = await tx
        .select({ revisionId: documentRefs.revisionId })
        .from(documentRefs)
        .where(and(eq(documentRefs.documentId, rawDocId), eq(documentRefs.name, 'draft')))
        .limit(1);
      const expectedHead = refRows[0]?.revisionId ?? null;
      if (expectedHead === null) {
        throw new ActionError('这篇文章还没有草稿修订，无法回滚');
      }
      if (expectedHead === rawTargetRevisionId) {
        throw new ActionError('目标修订就是当前草稿，无需回滚');
      }

      const headTree = await tx
        .select({ blockId: revisionBlocks.blockId, hash: revisionBlocks.blobHash })
        .from(revisionBlocks)
        .where(eq(revisionBlocks.revisionId, expectedHead))
        .orderBy(asc(revisionBlocks.position));
      const headEntries: ManifestEntry[] = headTree.map((r) => ({
        blockId: r.blockId,
        hash: r.hash,
      }));
      const headSeqRows = await tx
        .select({ seq: revisions.seq })
        .from(revisions)
        .where(eq(revisions.id, expectedHead))
        .limit(1);
      const parentSeq = headSeqRows[0]?.seq ?? 0;

      const changes = diffManifests(headEntries, targetEntries);
      if (changes.length === 0) {
        throw new ActionError('目标修订与当前草稿内容一致，无需回滚');
      }

      const newSeq = parentSeq + 1;
      const revInserted = await tx
        .insert(revisions)
        .values({
          documentId: rawDocId,
          seq: newSeq,
          parentId: expectedHead,
          authorId: actor.id,
          committerId: actor.id,
          kind: 'rollback',
          message: `回滚到第 ${target.seq} 号修订`,
          manifestHash: hashManifest(targetEntries),
          schemaVersion: target.schemaVersion,
          charsDelta: 0,
          blocksChanged: changes.length,
        })
        .returning({ id: revisions.id });
      const revisionId = revInserted[0]?.id;
      if (revisionId === undefined) {
        throw new ActionError('回滚修订写入失败，请稍后重试');
      }

      await tx.insert(revisionBlocks).values(
        targetTree.map((r) => ({
          revisionId,
          position: r.position,
          blockId: r.blockId,
          blobHash: r.blobHash,
        })),
      );
      await tx.insert(revisionChanges).values(changes.map((c) => toChangeRow(revisionId, c)));

      // CAS 移 draft ref，与提交同一闸门
      const moved = await tx
        .update(documentRefs)
        .set({ revisionId, updatedAt: new Date() })
        .where(
          and(
            eq(documentRefs.documentId, rawDocId),
            eq(documentRefs.name, 'draft'),
            eq(documentRefs.revisionId, expectedHead),
          ),
        )
        .returning({ documentId: documentRefs.documentId });
      if (moved.length === 0) {
        throw new ActionError('回滚冲突：草稿在你操作期间已被更新，请刷新页面后重试');
      }

      // 还原作者工作副本到目标内容，并把基底指向新修订（后续编辑基于还原后的内容）
      const restoredDoc = await loadRevisionDoc(tx, revisionId);
      const validated = validateDoc(restoredDoc);
      const nowTs = new Date();
      await tx
        .insert(workingCopies)
        .values({
          documentId: rawDocId,
          userId: actor.id,
          content: validated,
          baseRevisionId: revisionId,
          updatedAt: nowTs,
        })
        .onConflictDoUpdate({
          target: [workingCopies.documentId, workingCopies.userId],
          set: { content: validated, baseRevisionId: revisionId, updatedAt: nowTs },
        });
      await tx.update(documents).set({ updatedAt: nowTs }).where(eq(documents.id, rawDocId));
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'doc.rollback',
        subjectType: 'revision',
        subjectId: revisionId,
        sectionId: docRow.sectionId,
        detail: {
          documentId: rawDocId,
          targetRevisionId: rawTargetRevisionId,
          targetSeq: target.seq,
        },
      });
      return newSeq;
    });
    return { ok: true, data: { seq } };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return fail('回滚冲突：草稿在你操作期间已被更新，请刷新页面后重试');
    }
    return toFailure(err, '回滚失败，请稍后重试');
  }
}

/**
 * 协作直接编辑已发布文章（架构 §5 巡查梯度）：TL2 改 open 文档 / TL3 改 semi 文档即时生效，
 * 进 edit_patrol 巡查队列（事后巡查）。仅非作者走此路径；作者改自己文章仍用草稿+审批流。
 * 单事务：建新修订（parent=当前发布修订）→ CAS 移 published ref → 重建快照 → 写 search outbox
 * （触发搜索同步 + 行内锚点重映射）→ 按义务入巡查队列 → 通知作者 → 审计。
 */
export async function directEditPublished(
  rawDocId: string,
  contentJson: unknown,
  rawMessage: string,
): Promise<ActionResult<{ seq: number }>> {
  const actor = await requireActor();
  if (!actor) {
    return fail('请先登录');
  }
  if (!uuidSchema.safeParse(rawDocId).success) {
    return fail('文档参数非法');
  }
  const messageParsed = z.string().trim().max(500, '修订说明最长 500 字').safeParse(rawMessage);
  if (!messageParsed.success) {
    return fail(messageParsed.error.issues[0]?.message ?? '修订说明校验失败');
  }
  const message = messageParsed.data.length > 0 ? messageParsed.data : null;

  const docRow = await findDoc(rawDocId);
  if (!docRow) {
    return fail('文章不存在');
  }
  if (docRow.status !== 'published') {
    return fail('只能协作编辑已发布的文章');
  }
  if (docRow.ownerId === actor.id) {
    return fail('作者请通过「写文章」的草稿与发布审批流程修改自己的文章');
  }
  const decision = can(actor, 'doc.edit_direct', {
    sectionId: docRow.sectionId,
    doc: toDocCtx(docRow),
  });
  if (!decision.allow) {
    return fail(explainDeny(decision.reason));
  }
  const needsPatrol = decision.obligations.some((o) => o.type === 'enqueue_patrol');

  let validated: DocJson;
  try {
    validated = validateDoc(contentJson);
  } catch (err) {
    return fail(err instanceof Error ? err.message : '内容校验失败');
  }

  const db = getDb();
  try {
    const seq = await db.transaction(async (tx) => {
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
          throw new ActionError(`块身份冲突：${entry.blockId} 映射重复，请刷新页面后重试`);
        }
        nodeByDbId.set(dbId, node);
        dbEntries.push({ blockId: dbId, hash: entry.hash });
      });

      // 当前发布修订（协作编辑基于发布线，不动作者草稿分支）
      const refRows = await tx
        .select({ revisionId: documentRefs.revisionId })
        .from(documentRefs)
        .where(and(eq(documentRefs.documentId, rawDocId), eq(documentRefs.name, 'published')))
        .limit(1);
      const expectedHead = refRows[0]?.revisionId ?? null;
      if (expectedHead === null) {
        throw new ActionError('文章没有发布修订，无法协作编辑');
      }

      const parentRows = await tx
        .select({ blockId: revisionBlocks.blockId, hash: revisionBlocks.blobHash })
        .from(revisionBlocks)
        .where(eq(revisionBlocks.revisionId, expectedHead))
        .orderBy(asc(revisionBlocks.position));
      const parentEntries: ManifestEntry[] = parentRows.map((r) => ({
        blockId: r.blockId,
        hash: r.hash,
      }));
      const parentHashes = new Set(parentRows.map((r) => r.hash));
      const maxSeqRows = await tx
        .select({ maxSeq: sql<number>`coalesce(max(${revisions.seq}), 0)` })
        .from(revisions)
        .where(eq(revisions.documentId, rawDocId));
      const parentSeq = Number(maxSeqRows[0]?.maxSeq ?? 0);

      const changes = diffManifests(parentEntries, dbEntries);
      if (changes.length === 0) {
        throw new ActionError('内容与当前发布版本完全一致，无需提交');
      }

      const textByHash = new Map<string, string>();
      for (const [hash, node] of manifest.blobs) {
        textByHash.set(hash, extractText(node));
      }
      const blobRows = [...manifest.blobs]
        .filter(([hash]) => !parentHashes.has(hash))
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

      const newSeq = parentSeq + 1;
      const revInserted = await tx
        .insert(revisions)
        .values({
          documentId: rawDocId,
          seq: newSeq,
          parentId: expectedHead,
          authorId: actor.id,
          committerId: actor.id,
          kind: 'edit',
          message,
          manifestHash: hashManifest(dbEntries),
          schemaVersion: SCHEMA_VERSION,
          blocksChanged: changes.length,
        })
        .returning({ id: revisions.id });
      const revisionId = revInserted[0]?.id;
      if (revisionId === undefined) {
        throw new ActionError('修订写入失败，请稍后重试');
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
              bornRevisionId: revisionId,
            })),
          )
          .onConflictDoNothing({ target: blocks.id });
      }

      // 跨文档块身份劫持防线（同 commitRevision）
      if (dbEntries.length > 0) {
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
            throw new ActionError('块身份校验失败：存在不属于本文档的块引用，请刷新页面后重试');
          }
        }
        await tx.insert(revisionBlocks).values(
          dbEntries.map((entry, position) => ({
            revisionId,
            position,
            blockId: entry.blockId,
            blobHash: entry.hash,
          })),
        );
      }
      await tx.insert(revisionChanges).values(changes.map((c) => toChangeRow(revisionId, c)));

      // CAS 移 published ref：协作编辑即时生效
      const now = new Date();
      const moved = await tx
        .update(documentRefs)
        .set({ revisionId, updatedAt: now })
        .where(
          and(
            eq(documentRefs.documentId, rawDocId),
            eq(documentRefs.name, 'published'),
            eq(documentRefs.revisionId, expectedHead),
          ),
        )
        .returning({ documentId: documentRefs.documentId });
      if (moved.length === 0) {
        throw new ActionError('编辑冲突：文章在你编辑期间已被更新，请刷新页面后重试');
      }

      // 重建发布快照（读路径 O(1)）
      const assembled = await loadRevisionDoc(tx, revisionId);
      const snapshot = validateDoc(assembled);
      await tx
        .update(publishedSnapshots)
        .set({ revisionId, content: snapshot, publishedAt: now })
        .where(eq(publishedSnapshots.documentId, rawDocId));
      await tx.update(documents).set({ updatedAt: now }).where(eq(documents.id, rawDocId));

      // 搜索同步 + 行内锚点重映射（worker 消费）
      await tx
        .insert(searchOutbox)
        .values({ topic: 'doc.published', payload: { docId: rawDocId } });

      // 事后巡查：进 edit_patrol 队列（subject = 本次修订）
      if (needsPatrol) {
        await tx
          .insert(reviewItems)
          .values({
            queue: 'edit_patrol',
            subjectType: 'revision',
            subjectId: revisionId,
            sectionId: docRow.sectionId,
          })
          .onConflictDoNothing();
      }

      await insertNotification(tx, {
        recipientId: docRow.ownerId,
        actorId: actor.id,
        kind: 'doc_edited',
        payload: {
          docId: rawDocId,
          slug: docRow.slug,
          title: docRow.title,
          revisionId,
          seq: newSeq,
        },
      });
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'doc.collab_edit',
        subjectType: 'revision',
        subjectId: revisionId,
        sectionId: docRow.sectionId,
        detail: { documentId: rawDocId, seq: newSeq, patrol: needsPatrol },
      });
      return newSeq;
    });
    return { ok: true, data: { seq } };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return fail('编辑冲突：文章在你编辑期间已被更新，请刷新页面后重试');
    }
    return toFailure(err, '协作编辑失败，请稍后重试');
  }
}
