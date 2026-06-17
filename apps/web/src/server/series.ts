// 博客系列读路径（ADR-0014）：系列页 / 个人主页 / 博客底部导航 / 管理页 / 撰写器选择器共用。
// 系列是作者编排元数据，读路径按调用方需要分别取（公开视图只露已发布条目，所有者另见草稿）。
import {
  documents,
  getDb,
  publishedSnapshots,
  sections,
  series,
  seriesItems,
  user as userTable,
} from '@harublog/db';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';

export interface SeriesHead {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  ownerId: string;
  ownerName: string | null;
  ownerImage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SeriesItemRow {
  documentId: string;
  slug: string;
  title: string;
  summary: string | null;
  status: string;
  position: number;
  sectionName: string;
  sectionSlug: string;
  publishedAt: Date | null;
}

/** 系列概览（含条目计数），个人主页与「我的系列」列表用。 */
export interface SeriesBrief {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  updatedAt: Date;
  total: number;
  published: number;
}

/** 按 slug 取系列头 + 全部条目（按 position）。调用方据所有者身份再过滤草稿。 */
export async function loadSeriesBySlug(
  slug: string,
): Promise<{ head: SeriesHead; items: SeriesItemRow[] } | null> {
  const db = getDb();
  const headRows = await db
    .select({
      id: series.id,
      slug: series.slug,
      title: series.title,
      description: series.description,
      ownerId: series.ownerId,
      ownerName: userTable.name,
      ownerImage: userTable.image,
      createdAt: series.createdAt,
      updatedAt: series.updatedAt,
    })
    .from(series)
    .leftJoin(userTable, eq(userTable.id, series.ownerId))
    .where(eq(series.slug, slug))
    .limit(1);
  const head = headRows[0];
  if (head === undefined) {
    return null;
  }
  const items = await loadSeriesItems(head.id);
  return { head, items };
}

/** 系列全部条目（含草稿/审校中），按 position 升序。 */
export async function loadSeriesItems(seriesId: string): Promise<SeriesItemRow[]> {
  return getDb()
    .select({
      documentId: seriesItems.documentId,
      slug: documents.slug,
      title: documents.title,
      summary: documents.summary,
      status: documents.status,
      position: seriesItems.position,
      sectionName: sections.name,
      sectionSlug: sections.slug,
      publishedAt: publishedSnapshots.publishedAt,
    })
    .from(seriesItems)
    .innerJoin(documents, eq(documents.id, seriesItems.documentId))
    .innerJoin(sections, eq(sections.id, documents.sectionId))
    .leftJoin(publishedSnapshots, eq(publishedSnapshots.documentId, documents.id))
    .where(eq(seriesItems.seriesId, seriesId))
    .orderBy(asc(seriesItems.position), asc(seriesItems.addedAt));
}

/** 某用户的系列概览（含总数 / 已发布数）；onlyWithPublished=true 时只留有已发布条目的（公开主页用）。 */
export async function listUserSeries(
  ownerId: string,
  opts: { onlyWithPublished?: boolean } = {},
): Promise<SeriesBrief[]> {
  const rows = await getDb()
    .select({
      id: series.id,
      slug: series.slug,
      title: series.title,
      description: series.description,
      updatedAt: series.updatedAt,
      total: count(seriesItems.documentId),
      published: sql<number>`count(*) filter (where ${documents.status} = 'published')::int`,
    })
    .from(series)
    .leftJoin(seriesItems, eq(seriesItems.seriesId, series.id))
    .leftJoin(documents, eq(documents.id, seriesItems.documentId))
    .where(eq(series.ownerId, ownerId))
    .groupBy(series.id)
    .orderBy(desc(series.updatedAt));
  const briefs = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    updatedAt: r.updatedAt,
    total: Number(r.total),
    published: Number(r.published),
  }));
  return opts.onlyWithPublished ? briefs.filter((b) => b.published > 0) : briefs;
}

/** 撰写器系列选择器用：作者的系列（id+title）+ 当前文档所属系列 id。 */
export async function loadSeriesPicker(
  ownerId: string,
  docId: string,
): Promise<{ options: { id: string; title: string }[]; currentSeriesId: string | null }> {
  const db = getDb();
  const [opts, current] = await Promise.all([
    db
      .select({ id: series.id, title: series.title })
      .from(series)
      .where(eq(series.ownerId, ownerId))
      .orderBy(desc(series.updatedAt)),
    db
      .select({ seriesId: seriesItems.seriesId })
      .from(seriesItems)
      .where(eq(seriesItems.documentId, docId))
      .limit(1),
  ]);
  return { options: opts, currentSeriesId: current[0]?.seriesId ?? null };
}

export interface SeriesNav {
  seriesSlug: string;
  seriesTitle: string;
  /** 当前博客在已发布条目中的序号（1 基）与已发布总数 */
  index: number;
  total: number;
  prev: { slug: string; title: string } | null;
  next: { slug: string; title: string } | null;
}

/** 博客底部系列导航：文档所属系列 + 在已发布条目中的位次与上一篇/下一篇。不属于任何系列返回 null。 */
export async function getDocSeriesNav(docId: string): Promise<SeriesNav | null> {
  const db = getDb();
  const memberRows = await db
    .select({ seriesId: seriesItems.seriesId })
    .from(seriesItems)
    .where(eq(seriesItems.documentId, docId))
    .limit(1);
  const seriesId = memberRows[0]?.seriesId;
  if (seriesId === undefined) {
    return null;
  }
  const headRows = await db
    .select({ slug: series.slug, title: series.title })
    .from(series)
    .where(eq(series.id, seriesId))
    .limit(1);
  const head = headRows[0];
  if (head === undefined) {
    return null;
  }
  // 只在「已发布」条目里排序取邻篇
  const published = await db
    .select({ documentId: seriesItems.documentId, slug: documents.slug, title: documents.title })
    .from(seriesItems)
    .innerJoin(documents, eq(documents.id, seriesItems.documentId))
    .where(and(eq(seriesItems.seriesId, seriesId), eq(documents.status, 'published')))
    .orderBy(asc(seriesItems.position), asc(seriesItems.addedAt));
  const idx = published.findIndex((p) => p.documentId === docId);
  if (idx === -1) {
    return null;
  }
  const prevRow = idx > 0 ? published[idx - 1] : undefined;
  const nextRow = idx < published.length - 1 ? published[idx + 1] : undefined;
  return {
    seriesSlug: head.slug,
    seriesTitle: head.title,
    index: idx + 1,
    total: published.length,
    prev: prevRow !== undefined ? { slug: prevRow.slug, title: prevRow.title } : null,
    next: nextRow !== undefined ? { slug: nextRow.slug, title: nextRow.title } : null,
  };
}
