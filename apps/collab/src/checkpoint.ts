// onStoreDocument 缝合层（架构 §6.3）：把 Y.Doc 当前状态规范化为一次 collab_checkpoint 修订写回 PG。
// 「修订层才是真理与审计对象，CRDT 只是输入法」——Y.Doc 二进制不持久化，可随时从修订重建。
import type { Database } from '@harublog/db';
import {
  auditLog,
  blobs,
  blocks,
  documentRefs,
  documents,
  hashManifest,
  revisionBlocks,
  revisionChanges,
  revisions,
  toDbBlockId,
} from '@harublog/db';
import { COLLAB_FRAGMENT, tiptapToKernel } from '@harublog/editor';
import type { BlockNode, ManifestEntry } from '@harublog/kernel';
import {
  buildManifest,
  CANON_VERSION,
  canonicalize,
  diffManifests,
  extractText,
  SCHEMA_VERSION,
  validateDoc,
} from '@harublog/kernel';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import type * as Y from 'yjs';

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

export interface CheckpointResult {
  changed: boolean;
  seq?: number;
}

/**
 * 把 Y.Doc 快照为草稿分支上的 collab_checkpoint 修订（与 commitRevision 同构）。
 * 内容无变化则跳过（不产生修订垃圾）。署名归草稿作者（会话级 co-author 追踪是后续细化）。
 */
export async function writeCheckpoint(
  db: Database,
  docId: string,
  ydoc: Y.Doc,
): Promise<CheckpointResult> {
  // Y.Doc → Tiptap JSON → kernel DocJson（坏数据直接放弃本次 checkpoint）
  const tiptapJson = yDocToProsemirrorJSON(ydoc, COLLAB_FRAGMENT);
  const validated = validateDoc(tiptapToKernel(tiptapJson));

  const docRow = (
    await db
      .select({ ownerId: documents.ownerId })
      .from(documents)
      .where(eq(documents.id, docId))
      .limit(1)
  )[0];
  if (!docRow) {
    return { changed: false };
  }
  const authorId = docRow.ownerId;

  return db.transaction(async (tx) => {
    const manifest = buildManifest(validated);
    const dbEntries: ManifestEntry[] = [];
    const nodeByDbId = new Map<string, BlockNode>();
    validated.content.forEach((node, i) => {
      const entry = manifest.entries[i];
      if (!entry) {
        return;
      }
      const dbId = toDbBlockId(docId, entry.blockId);
      if (nodeByDbId.has(dbId)) {
        throw new Error('块身份冲突');
      }
      nodeByDbId.set(dbId, node);
      dbEntries.push({ blockId: dbId, hash: entry.hash });
    });

    const refRows = await tx
      .select({ revisionId: documentRefs.revisionId })
      .from(documentRefs)
      .where(and(eq(documentRefs.documentId, docId), eq(documentRefs.name, 'draft')))
      .limit(1);
    const expectedHead = refRows[0]?.revisionId ?? null;

    let parentEntries: ManifestEntry[] = [];
    let parentSeq = 0;
    const parentHashes = new Set<string>();
    if (expectedHead !== null) {
      const parentRev = await tx
        .select({ seq: revisions.seq })
        .from(revisions)
        .where(eq(revisions.id, expectedHead))
        .limit(1);
      parentSeq = parentRev[0]?.seq ?? 0;
      const parentRows = await tx
        .select({ blockId: revisionBlocks.blockId, hash: revisionBlocks.blobHash })
        .from(revisionBlocks)
        .where(eq(revisionBlocks.revisionId, expectedHead))
        .orderBy(asc(revisionBlocks.position));
      parentEntries = parentRows.map((r) => ({ blockId: r.blockId, hash: r.hash }));
      for (const r of parentRows) parentHashes.add(r.hash);
    }

    const changes = diffManifests(parentEntries, dbEntries);
    if (changes.length === 0) {
      return { changed: false };
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
        documentId: docId,
        seq: newSeq,
        parentId: expectedHead,
        authorId,
        committerId: authorId,
        kind: 'collab_checkpoint',
        message: '协作快照',
        manifestHash: hashManifest(dbEntries),
        schemaVersion: SCHEMA_VERSION,
        blocksChanged: changes.length,
      })
      .returning({ id: revisions.id });
    const revisionId = revInserted[0]?.id;
    if (revisionId === undefined) {
      throw new Error('checkpoint 修订写入失败');
    }

    const addedIds = changes.filter((c) => c.kind === 'add').map((c) => c.blockId);
    if (addedIds.length > 0) {
      await tx
        .insert(blocks)
        .values(
          addedIds.map((id) => ({
            id,
            documentId: docId,
            type: nodeByDbId.get(id)?.type ?? 'paragraph',
            bornRevisionId: revisionId,
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
      if (ownedById.get(entry.blockId) !== docId) {
        throw new Error('块身份校验失败');
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
    await tx.insert(revisionChanges).values(changes.map((c) => toChangeRow(revisionId, c)));

    // CAS 移 draft ref（与 commitRevision 同一并发闸门）
    const now = new Date();
    if (expectedHead !== null) {
      const moved = await tx
        .update(documentRefs)
        .set({ revisionId, updatedAt: now })
        .where(
          and(
            eq(documentRefs.documentId, docId),
            eq(documentRefs.name, 'draft'),
            eq(documentRefs.revisionId, expectedHead),
          ),
        )
        .returning({ documentId: documentRefs.documentId });
      if (moved.length === 0) {
        throw new Error('checkpoint 冲突：草稿头已变更');
      }
    } else {
      await tx
        .insert(documentRefs)
        .values({ documentId: docId, name: 'draft', revisionId })
        .onConflictDoNothing();
    }

    await tx.update(documents).set({ updatedAt: now }).where(eq(documents.id, docId));
    await tx.insert(auditLog).values({
      actorId: authorId,
      action: 'doc.collab_checkpoint',
      subjectType: 'revision',
      subjectId: revisionId,
      detail: { documentId: docId, seq: newSeq, blocksChanged: changes.length },
    });
    return { changed: true, seq: newSeq };
  });
}
