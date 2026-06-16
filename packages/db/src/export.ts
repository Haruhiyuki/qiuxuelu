// 可移植数据导出（兑现公益承诺：全站内容可 dump）。导出对象自带 CC BY-NC-SA 协议与贡献者署名，
// 任何人可据此复刻内容。署名取自主线修订的全部作者（修订历史即贡献凭证，ADR-0003）。
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Database } from './client';
import {
  documents,
  publishedSnapshots,
  revisions,
  sections,
  user as userTable,
} from './schema/index';

export const EXPORT_SCHEMA = 'harublog/export@1';
export const CONTENT_LICENSE = 'CC-BY-NC-SA-4.0';

export interface DocumentExport {
  schema: typeof EXPORT_SCHEMA;
  license: typeof CONTENT_LICENSE;
  slug: string;
  title: string;
  summary: string | null;
  section: { slug: string; name: string };
  author: string;
  /** 主线全部修订作者去重（CC BY-NC-SA 要求向所有贡献者署名）。 */
  contributors: string[];
  publishedAt: string;
  updatedAt: string;
  /** 当前发布版完整内容（ProseMirror DocJson）。 */
  content: unknown;
  /** 主线修订历史元数据（不含建议分支）。 */
  history: { seq: number; kind: string; message: string | null; author: string; at: string }[];
}

type ReadDb = Pick<Database, 'select'>;

/** 组装单篇已发布文章的可移植导出对象；非已发布返回 null。 */
export async function buildDocumentExport(
  db: ReadDb,
  docId: string,
): Promise<DocumentExport | null> {
  const rows = await db
    .select({
      slug: documents.slug,
      title: documents.title,
      summary: documents.summary,
      status: documents.status,
      updatedAt: documents.updatedAt,
      ownerName: userTable.name,
      sectionSlug: sections.slug,
      sectionName: sections.name,
      content: publishedSnapshots.content,
      publishedAt: publishedSnapshots.publishedAt,
    })
    .from(documents)
    .innerJoin(publishedSnapshots, eq(publishedSnapshots.documentId, documents.id))
    .innerJoin(sections, eq(sections.id, documents.sectionId))
    .leftJoin(userTable, eq(userTable.id, documents.ownerId))
    .where(and(eq(documents.id, docId), eq(documents.status, 'published')))
    .limit(1);
  const doc = rows[0];
  if (!doc) {
    return null;
  }

  // 主线修订历史 + 贡献者（建议分支 suggestion_id 非空，不计入主线署名）
  const revRows = await db
    .select({
      seq: revisions.seq,
      kind: revisions.kind,
      message: revisions.message,
      createdAt: revisions.createdAt,
      authorName: userTable.name,
    })
    .from(revisions)
    .leftJoin(userTable, eq(userTable.id, revisions.authorId))
    .where(and(eq(revisions.documentId, docId), isNull(revisions.suggestionId)))
    .orderBy(asc(revisions.seq));

  const contributors = [...new Set(revRows.map((r) => r.authorName ?? '佚名'))];

  return {
    schema: EXPORT_SCHEMA,
    license: CONTENT_LICENSE,
    slug: doc.slug,
    title: doc.title,
    summary: doc.summary,
    section: { slug: doc.sectionSlug, name: doc.sectionName },
    author: doc.ownerName ?? '佚名',
    contributors,
    publishedAt: doc.publishedAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    content: doc.content,
    history: revRows.map((r) => ({
      seq: r.seq,
      kind: r.kind,
      message: r.message,
      author: r.authorName ?? '佚名',
      at: r.createdAt.toISOString(),
    })),
  };
}

/** 全部已发布文章的 docId 列表（导出迭代用）。 */
export async function listPublishedDocIds(db: ReadDb): Promise<string[]> {
  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.status, 'published'))
    .orderBy(asc(documents.createdAt));
  return rows.map((r) => r.id);
}
