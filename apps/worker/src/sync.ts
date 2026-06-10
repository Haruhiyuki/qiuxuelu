// 文档 → Meilisearch 块级索引的同步逻辑（worker 与 reindex 共用）。
import type { Database } from '@harublog/db';
import {
  blobs,
  documentRefs,
  documents,
  publishedSnapshots,
  revisionBlocks,
  sections,
} from '@harublog/db';
import { type BlockSearchDoc, indexDocumentBlocks, removeDocument } from '@harublog/search';
import { and, asc, eq } from 'drizzle-orm';

type ReadDb = Pick<Database, 'select'>;

/**
 * 把一篇文章的「当前已发布修订」的全部块同步进搜索索引（幂等，读当前状态）。
 * 文章非 published / 无 published 指针 → 视为下线，移除其索引。
 * 这样 'doc.published' 与 'doc.unpublished' 两个 outbox 主题都可走同一处理。
 */
export async function syncDocument(db: ReadDb, docId: string): Promise<void> {
  const docRows = await db
    .select({
      id: documents.id,
      slug: documents.slug,
      title: documents.title,
      status: documents.status,
      sectionSlug: sections.slug,
      sectionName: sections.name,
    })
    .from(documents)
    .innerJoin(sections, eq(sections.id, documents.sectionId))
    .where(eq(documents.id, docId))
    .limit(1);
  const doc = docRows[0];
  if (doc?.status !== 'published') {
    await removeDocument(docId);
    return;
  }

  const refRows = await db
    .select({ revisionId: documentRefs.revisionId })
    .from(documentRefs)
    .where(and(eq(documentRefs.documentId, docId), eq(documentRefs.name, 'published')))
    .limit(1);
  const publishedRevisionId = refRows[0]?.revisionId;
  if (publishedRevisionId === undefined) {
    await removeDocument(docId);
    return;
  }

  const snapRows = await db
    .select({ publishedAt: publishedSnapshots.publishedAt })
    .from(publishedSnapshots)
    .where(eq(publishedSnapshots.documentId, docId))
    .limit(1);
  const publishedAt = snapRows[0]?.publishedAt?.getTime() ?? Date.now();

  const blockRows = await db
    .select({
      blockId: revisionBlocks.blockId,
      position: revisionBlocks.position,
      text: blobs.textPlain,
    })
    .from(revisionBlocks)
    .innerJoin(blobs, eq(blobs.hash, revisionBlocks.blobHash))
    .where(eq(revisionBlocks.revisionId, publishedRevisionId))
    .orderBy(asc(revisionBlocks.position));

  const records: BlockSearchDoc[] = blockRows
    // 跳过纯空块（分隔线等），它们对搜索无意义
    .filter((b) => b.text.trim().length > 0)
    .map((b) => ({
      id: `${docId}_${b.blockId}`,
      docId,
      slug: doc.slug,
      title: doc.title,
      sectionSlug: doc.sectionSlug,
      sectionName: doc.sectionName,
      blockId: b.blockId,
      position: b.position,
      text: b.text,
      publishedAt,
    }));

  await indexDocumentBlocks(docId, records);
}
