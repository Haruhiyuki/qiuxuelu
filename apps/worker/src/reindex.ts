// 全量重建搜索索引：Meilisearch 非真相源，任何时候都能从 Postgres 重放出来。
// 用法：pnpm --filter @harublog/worker reindex
import { documents, getDb } from '@harublog/db';
import { ensureBlocksIndex } from '@harublog/search';
import { eq } from 'drizzle-orm';
import { syncDocument } from './sync';

async function main(): Promise<void> {
  const db = getDb();
  await ensureBlocksIndex();
  const docs = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.status, 'published'));
  console.log(`[reindex] 共 ${docs.length} 篇已发布博客，开始重建…`);
  for (const d of docs) {
    await syncDocument(db, d.id);
    console.log(`[reindex] ✓ ${d.id}`);
  }
  console.log('[reindex] 完成');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('[reindex] 失败：', err);
    process.exit(1);
  },
);
