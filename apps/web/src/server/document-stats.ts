// 文章统计：阅读量只按打开次数累加，不采集访客身份，不依赖登录。
import { type Database, documentStats } from '@harublog/db';
import { eq, sql } from 'drizzle-orm';

type ReadDb = Pick<Database, 'select'>;
type WriteDb = Pick<Database, 'insert' | 'select'>;

export async function getDocumentViewCount(db: ReadDb, docId: string): Promise<number> {
  const rows = await db
    .select({ viewCount: documentStats.viewCount })
    .from(documentStats)
    .where(eq(documentStats.documentId, docId))
    .limit(1);
  return rows[0]?.viewCount ?? 0;
}

export async function incrementDocumentView(db: WriteDb, docId: string): Promise<number> {
  const rows = await db
    .insert(documentStats)
    .values({ documentId: docId, viewCount: 1 })
    .onConflictDoUpdate({
      target: documentStats.documentId,
      set: {
        viewCount: sql`${documentStats.viewCount} + 1`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ viewCount: documentStats.viewCount });
  return rows[0]?.viewCount ?? 0;
}
