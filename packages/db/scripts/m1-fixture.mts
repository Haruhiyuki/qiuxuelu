// M1 冒烟 fixture：按 commitRevision 方式造「多修订 + 已发布」文档，供 HTTP 验证 diff/history/回滚。
// 仅本地手动运行（pnpm --filter @harublog/db exec tsx scripts/m1-fixture.mts），不入 CI。
import { randomUUID } from 'node:crypto';
import {
  buildManifest,
  CANON_VERSION,
  canonicalize,
  type DocJson,
  extractText,
  SCHEMA_VERSION,
  validateDoc,
} from '@harublog/kernel';
import { eq } from 'drizzle-orm';
import { getDb } from '../src/client';
import {
  blobs,
  blocks,
  documentRefs,
  documents,
  publishedSnapshots,
  revisionBlocks,
  revisions,
  sections,
  user as userTable,
} from '../src/schema/index';

const db = getDb();

function para(blockId: string, text: string): unknown {
  return { type: 'paragraph', attrs: { blockId }, content: [{ type: 'text', text }] };
}

async function main(): Promise<void> {
  const ownerId = 'smoke-owner';
  await db
    .insert(userTable)
    .values({ id: ownerId, name: '冒烟作者', email: 'smoke-owner@test.local' })
    .onConflictDoNothing();

  const section = (
    await db.select().from(sections).where(eq(sections.slug, 'methodology')).limit(1)
  )[0];
  if (!section) throw new Error('缺少 methodology 板块，请先 pnpm db:seed');

  const slug = `m1-smoke-${randomUUID().slice(0, 8)}`;
  const docId = randomUUID();
  await db.insert(documents).values({
    id: docId,
    sectionId: section.id,
    slug,
    title: 'M1 冒烟：高考复习经验',
    ownerId,
    status: 'draft',
    schemaVersion: SCHEMA_VERSION,
  });

  let parentId: string | null = null;
  let seq = 0;

  async function commit(doc: DocJson, kind: string, message: string): Promise<string> {
    const manifest = buildManifest(validateDoc(doc));
    const revisionId = randomUUID();
    seq += 1;
    const blobRows = [...manifest.blobs].map(([hash, node]) => ({
      hash,
      canonVersion: CANON_VERSION,
      schemaVersion: SCHEMA_VERSION,
      content: node,
      textPlain: extractText(node),
      sizeBytes: Buffer.byteLength(canonicalize(node), 'utf8'),
    }));
    if (blobRows.length > 0) await db.insert(blobs).values(blobRows).onConflictDoNothing();
    await db.insert(revisions).values({
      id: revisionId,
      documentId: docId,
      seq,
      parentId,
      authorId: ownerId,
      committerId: ownerId,
      kind,
      message,
      manifestHash: randomUUID(),
      schemaVersion: SCHEMA_VERSION,
      blocksChanged: manifest.entries.length,
    });
    const blockRows = manifest.entries.map((e, i) => ({
      id: e.blockId,
      documentId: docId,
      type: (doc.content[i] as { type: string }).type,
      bornRevisionId: revisionId,
    }));
    if (blockRows.length > 0) await db.insert(blocks).values(blockRows).onConflictDoNothing();
    await db.insert(revisionBlocks).values(
      manifest.entries.map((e, position) => ({
        revisionId,
        position,
        blockId: e.blockId,
        blobHash: e.hash,
      })),
    );
    parentId = revisionId;
    return revisionId;
  }

  const b1 = randomUUID();
  const b2 = randomUUID();
  const b3 = randomUUID();

  const v1 = {
    type: 'doc',
    content: [para(b1, '高三这一年，规律作息比熬夜刷题更重要。'), para(b2, '错题本要每周复盘。')],
  } as DocJson;
  await commit(v1, 'edit', '初稿');

  const v2 = {
    type: 'doc',
    content: [
      para(b1, '高三这一年，规律作息比熬夜刷题更重要。'),
      para(b2, '错题本要每天复盘，而不是攒到周末。'),
      para(b3, '心态调整：把模考当练习。'),
    ],
  } as DocJson;
  const r2 = await commit(v2, 'edit', '补充错题本与心态');

  await db
    .insert(documentRefs)
    .values({ documentId: docId, name: 'published', revisionId: r2 })
    .onConflictDoNothing();
  await db.insert(publishedSnapshots).values({
    documentId: docId,
    revisionId: r2,
    content: validateDoc(v2),
    approvedBy: ownerId,
  });
  await db.update(documents).set({ status: 'published' }).where(eq(documents.id, docId));

  const v3 = {
    type: 'doc',
    content: [
      para(b1, '高三这一年，规律作息远比熬夜刷题更重要，睡眠是第一生产力。'),
      para(b2, '错题本要每天复盘，而不是攒到周末。'),
      para(b3, '心态调整：把模考当练习。'),
    ],
  } as DocJson;
  const r3 = await commit(v3, 'edit', '强化作息论点');
  await db
    .insert(documentRefs)
    .values({ documentId: docId, name: 'draft', revisionId: r3 })
    .onConflictDoNothing();

  console.log(`SLUG=${slug}`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
