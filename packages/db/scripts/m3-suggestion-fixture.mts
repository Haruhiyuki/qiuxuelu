// 本地 fixture：在已发布的 m1-smoke 文档上造一条编辑建议分支（复刻 createSuggestion 的核心写入）。
// 用法：pnpm --filter @harublog/db exec tsx scripts/m3-suggestion-fixture.mts
// 输出 SUGGESTION=<id> SLUG=<slug>，供 /suggestions/<id> 与合并冒烟使用。
import { randomUUID } from 'node:crypto';
import {
  buildManifest,
  CANON_VERSION,
  canonicalize,
  type DocJson,
  diffManifests,
  extractText,
  SCHEMA_VERSION,
} from '@harublog/kernel';
import { and, asc, eq, like, sql } from 'drizzle-orm';
import { getDb } from '../src/client';
import {
  blobs,
  documentRefs,
  documents,
  revisionBlocks,
  revisions,
  suggestions,
  user as userTable,
} from '../src/schema/index';

const db = getDb();

async function main(): Promise<void> {
  const doc = (
    await db
      .select({ id: documents.id, slug: documents.slug, sectionId: documents.sectionId })
      .from(documents)
      .where(and(like(documents.slug, 'm1-smoke-%'), eq(documents.status, 'published')))
      .limit(1)
  )[0];
  if (!doc) throw new Error('没有已发布的 m1-smoke 文档，先跑 m1-fixture');

  // 建议作者：consent 用户（TL2 非作者）
  const author = (
    await db.select().from(userTable).where(eq(userTable.email, 'consent@test.local')).limit(1)
  )[0];
  if (!author) throw new Error('缺少 consent@test.local 用户');

  const baseRevId = (
    await db
      .select({ revisionId: documentRefs.revisionId })
      .from(documentRefs)
      .where(and(eq(documentRefs.documentId, doc.id), eq(documentRefs.name, 'published')))
      .limit(1)
  )[0]?.revisionId;
  if (!baseRevId) throw new Error('文档无发布修订');

  // 载入 base 内容（注入 blockId），改第一段文字作为建议
  const baseBlocks = await db
    .select({ blockId: revisionBlocks.blockId, content: blobs.content })
    .from(revisionBlocks)
    .innerJoin(blobs, eq(blobs.hash, revisionBlocks.blobHash))
    .where(eq(revisionBlocks.revisionId, baseRevId))
    .orderBy(asc(revisionBlocks.position));

  const content = baseBlocks.map((b, i) => {
    const node = b.content as Record<string, unknown>;
    const attrs = (typeof node.attrs === 'object' && node.attrs ? node.attrs : {}) as Record<
      string,
      unknown
    >;
    const withId = { ...node, attrs: { ...attrs, blockId: b.blockId } };
    if (i === 0) {
      // 修改第一段：建议改写
      return {
        ...withId,
        content: [{ type: 'text', text: '【建议】高三这一年，规律作息与稳定心态同样关键。' }],
      };
    }
    return withId;
  });
  const docJson = { type: 'doc', content } as DocJson;

  const manifest = buildManifest(docJson);
  const baseEntries = baseBlocks.map((b, i) => {
    const node = manifest.entries[i];
    return { blockId: b.blockId, hash: node?.hash ?? '' };
  });
  // base 的真实 hash 需重算（base 内容未改的块 hash 与 manifest 对应项一致，仅首块不同）；
  // 直接用 revision_blocks 的 blobHash 作为 base hash 更准：
  const baseRealEntries = await db
    .select({ blockId: revisionBlocks.blockId, hash: revisionBlocks.blobHash })
    .from(revisionBlocks)
    .where(eq(revisionBlocks.revisionId, baseRevId))
    .orderBy(asc(revisionBlocks.position));
  void baseEntries;

  const dbEntries = manifest.entries.map((e) => ({ blockId: e.blockId, hash: e.hash }));
  const changes = diffManifests(
    baseRealEntries.map((b) => ({ blockId: b.blockId, hash: b.hash })),
    dbEntries,
  );
  const baseHashes = new Set(baseRealEntries.map((b) => b.hash));

  const suggestionId = randomUUID();
  const headRevId = randomUUID();
  const maxSeq = Number(
    (
      await db
        .select({ m: sql<number>`coalesce(max(${revisions.seq}),0)` })
        .from(revisions)
        .where(eq(revisions.documentId, doc.id))
    )[0]?.m ?? 0,
  );

  // 新 blob（仅改动块）
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
    id: headRevId,
    documentId: doc.id,
    seq: maxSeq + 1,
    parentId: baseRevId,
    authorId: author.id,
    committerId: author.id,
    kind: 'edit',
    message: '建议改写首段',
    manifestHash: randomUUID(),
    schemaVersion: SCHEMA_VERSION,
    blocksChanged: changes.length,
    suggestionId,
  });
  await db.insert(revisionBlocks).values(
    dbEntries.map((e, position) => ({
      revisionId: headRevId,
      position,
      blockId: e.blockId,
      blobHash: e.hash,
    })),
  );
  await db
    .insert(documentRefs)
    .values({ documentId: doc.id, name: `suggestion/${suggestionId}`, revisionId: headRevId });
  await db.insert(suggestions).values({
    id: suggestionId,
    documentId: doc.id,
    authorId: author.id,
    baseRevisionId: baseRevId,
    headRevisionId: headRevId,
    status: 'open',
    note: '首段补充心态要点',
  });

  console.log(`SUGGESTION=${suggestionId} SLUG=${doc.slug} CHANGES=${changes.length}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
