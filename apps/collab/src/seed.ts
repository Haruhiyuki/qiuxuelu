// onLoadDocument：从草稿修订把内容种进 Y.Doc（修订是真相，Yjs 二进制是可丢弃热缓存）。
import type { Database } from '@harublog/db';
import { blobs, documentRefs, revisionBlocks } from '@harublog/db';
import { COLLAB_FRAGMENT, getEditorSchema, kernelToTiptap } from '@harublog/editor';
import type { DocJson } from '@harublog/kernel';
import { validateDoc } from '@harublog/kernel';
import { and, asc, eq } from 'drizzle-orm';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';
import * as Y from 'yjs';

const schema = getEditorSchema();

/** 读草稿修订内容为 DocJson（与 web 的 loadRevisionDoc 同口径：按位置注入 blockId）。 */
async function loadDraftDoc(db: Database, docId: string): Promise<DocJson> {
  const refRows = await db
    .select({ revisionId: documentRefs.revisionId })
    .from(documentRefs)
    .where(and(eq(documentRefs.documentId, docId), eq(documentRefs.name, 'draft')))
    .limit(1);
  const draftRev = refRows[0]?.revisionId;
  if (draftRev === undefined) {
    return { type: 'doc', content: [] };
  }
  const rows = await db
    .select({ blockId: revisionBlocks.blockId, content: blobs.content })
    .from(revisionBlocks)
    .innerJoin(blobs, eq(blobs.hash, revisionBlocks.blobHash))
    .where(eq(revisionBlocks.revisionId, draftRev))
    .orderBy(asc(revisionBlocks.position));
  const content = rows.map((r) => {
    const node = (typeof r.content === 'object' && r.content !== null ? r.content : {}) as Record<
      string,
      unknown
    >;
    const attrs =
      typeof node.attrs === 'object' && node.attrs !== null
        ? (node.attrs as Record<string, unknown>)
        : {};
    return { ...node, attrs: { ...attrs, blockId: r.blockId } };
  });
  try {
    return validateDoc({ type: 'doc', content });
  } catch {
    return { type: 'doc', content: [] };
  }
}

/** 把草稿内容合并进给定 Y.Doc 的共享片段（onLoadDocument 调用）。 */
export async function seedYDoc(db: Database, docId: string, ydoc: Y.Doc): Promise<Y.Doc> {
  const docJson = await loadDraftDoc(db, docId);
  const tiptapJson = kernelToTiptap(docJson);
  const temp = prosemirrorJSONToYDoc(schema, tiptapJson, COLLAB_FRAGMENT);
  Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(temp));
  return ydoc;
}
