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
  reviewItems,
  revisionBlocks,
  revisionChanges,
  revisions,
  suggestions,
} from '@harublog/db';
import { can, explainDeny } from '@harublog/domain';
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
import { z } from 'zod';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';
import { loadActor } from '@/server/actors';
import { hashManifest, toDbBlockId } from '@/server/block-identity';
import { insertNotification } from '@/server/notifications';

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
    return fail('只能对已发布的文章提交编辑建议');
  }
  if (doc.ownerId === actor.id) {
    return fail('作者请直接编辑自己的文章，无需提建议');
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
        throw new Error('文章没有发布修订');
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
    return { ok: true, data: { suggestionId } };
  } catch (err) {
    if (err instanceof Error && err.message === 'EMPTY') {
      return fail('建议未做任何修改');
    }
    return fail('提交建议失败，请稍后重试');
  }
}
