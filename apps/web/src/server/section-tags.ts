// 板块内标签聚合（读路径，非 Server Action）：统计某板块已发布博客用到的标签及各自篇数。
// 标签全局存在（tags.name 站内唯一），但「分类」是按板块聚合的——同一个 #数学 可同时
// 出现在高中与大学板块，各板块各自统计自己的篇数。无需改 schema，纯派生。
import { type Database, documents, documentTags, publishedSnapshots, tags } from '@harublog/db';
import { and, desc, eq, sql } from 'drizzle-orm';

export interface SectionTag {
  name: string;
  count: number;
}

/** 某板块内、已发布博客用到的标签 + 篇数，按篇数降序（同数按名）。 */
export async function getSectionTags(
  db: Pick<Database, 'select'>,
  sectionId: string,
): Promise<SectionTag[]> {
  const rows = await db
    .select({
      name: tags.name,
      count: sql<number>`count(*)::int`,
    })
    .from(documentTags)
    .innerJoin(tags, eq(tags.id, documentTags.tagId))
    .innerJoin(documents, eq(documents.id, documentTags.documentId))
    .innerJoin(publishedSnapshots, eq(publishedSnapshots.documentId, documents.id))
    .where(eq(documents.sectionId, sectionId))
    .groupBy(tags.name)
    .orderBy(desc(sql`count(*)`), tags.name);
  return rows.map((r) => ({ name: r.name, count: Number(r.count) }));
}

/** 板块内已发布博客总数（「全部」分类的计数）。 */
export async function countSectionPublished(
  db: Pick<Database, 'select'>,
  sectionId: string,
): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(documents)
    .innerJoin(publishedSnapshots, eq(publishedSnapshots.documentId, documents.id))
    .where(eq(documents.sectionId, sectionId));
  return Number(rows[0]?.n ?? 0);
}

/** drizzle where 片段：限定某板块、可选某标签的已发布博客（供博客列表查询复用）。 */
export function sectionDocFilter(sectionId: string, tagName: string | null) {
  return tagName === null
    ? eq(documents.sectionId, sectionId)
    : and(
        eq(documents.sectionId, sectionId),
        sql`exists (select 1 from ${documentTags} dt join ${tags} t on t.id = dt.tag_id where dt.document_id = ${documents.id} and t.name = ${tagName})`,
      );
}
