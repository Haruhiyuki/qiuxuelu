// 让现有 open 建议产生冲突：把主线（published）也改在建议改的同一首块上，但内容不同。
// 用法：pnpm --filter @harublog/db exec tsx scripts/m3-conflict-fixture.mts
import { randomUUID } from 'node:crypto';
import {
  buildManifest,
  CANON_VERSION,
  canonicalize,
  type DocJson,
  extractText,
  SCHEMA_VERSION,
} from '@harublog/kernel';
import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb } from '../src/client';
import {
  blobs,
  documentRefs,
  documents,
  publishedSnapshots,
  revisionBlocks,
  revisions,
  suggestions,
} from '../src/schema/index';

const db = getDb();

async function main(): Promise<void> {
  const sg = (
    await db.select().from(suggestions).where(eq(suggestions.status, 'open')).limit(1)
  )[0];
  if (!sg) throw new Error('没有 open 建议，先跑 m3-suggestion-fixture');
  const doc = (
    await db.select().from(documents).where(eq(documents.id, sg.documentId)).limit(1)
  )[0];
  if (!doc) throw new Error('文档缺失');

  const pubRev = (
    await db
      .select({ revisionId: documentRefs.revisionId })
      .from(documentRefs)
      .where(and(eq(documentRefs.documentId, doc.id), eq(documentRefs.name, 'published')))
      .limit(1)
  )[0]?.revisionId;
  if (!pubRev) throw new Error('无发布修订');

  const baseBlocks = await db
    .select({
      blockId: revisionBlocks.blockId,
      hash: revisionBlocks.blobHash,
      content: blobs.content,
    })
    .from(revisionBlocks)
    .innerJoin(blobs, eq(blobs.hash, revisionBlocks.blobHash))
    .where(eq(revisionBlocks.revisionId, pubRev))
    .orderBy(asc(revisionBlocks.position));

  // 主线把首块改成另一种说法（与建议不同 → 冲突）
  const content = baseBlocks.map((b, i) => {
    const node = b.content as Record<string, unknown>;
    const attrs = (typeof node.attrs === 'object' && node.attrs ? node.attrs : {}) as Record<
      string,
      unknown
    >;
    const withId = { ...node, attrs: { ...attrs, blockId: b.blockId } };
    if (i === 0) {
      return {
        ...withId,
        content: [{ type: 'text', text: '【主线】高三这一年，效率与方法决定一切。' }],
      };
    }
    return withId;
  });
  const docJson = { type: 'doc', content } as DocJson;
  const manifest = buildManifest(docJson);

  const newRev = randomUUID();
  const maxSeq = Number(
    (
      await db
        .select({ m: sql<number>`coalesce(max(${revisions.seq}),0)` })
        .from(revisions)
        .where(eq(revisions.documentId, doc.id))
    )[0]?.m ?? 0,
  );
  const baseHashes = new Set(baseBlocks.map((b) => b.hash));
  for (const [hash, node] of manifest.blobs) {
    if (baseHashes.has(hash)) continue;
    await db
      .insert(blobs)
      .values({
        hash,
        canonVersion: CANON_VERSION,
        schemaVersion: SCHEMA_VERSION,
        content: node,
        textPlain: extractText(node),
        sizeBytes: Buffer.byteLength(canonicalize(node), 'utf8'),
      })
      .onConflictDoNothing();
  }
  await db.insert(revisions).values({
    id: newRev,
    documentId: doc.id,
    seq: maxSeq + 1,
    parentId: pubRev,
    authorId: doc.ownerId,
    committerId: doc.ownerId,
    kind: 'edit',
    message: '主线修订首块（制造冲突）',
    manifestHash: randomUUID(),
    schemaVersion: SCHEMA_VERSION,
    blocksChanged: 1,
  });
  await db.insert(revisionBlocks).values(
    manifest.entries.map((e, position) => ({
      revisionId: newRev,
      position,
      blockId: e.blockId,
      blobHash: e.hash,
    })),
  );
  await db
    .update(documentRefs)
    .set({ revisionId: newRev })
    .where(and(eq(documentRefs.documentId, doc.id), eq(documentRefs.name, 'published')));
  await db
    .update(publishedSnapshots)
    .set({ revisionId: newRev, content: docJson })
    .where(eq(publishedSnapshots.documentId, doc.id));

  console.log(`CONFLICT_READY suggestion=${sg.id} doc=${doc.id} newPublished=${newRev}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
