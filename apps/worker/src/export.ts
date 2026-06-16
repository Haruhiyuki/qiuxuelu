// 全站内容导出（公益承诺：可随时 dump）。逐篇已发布文章输出一行 JSON（NDJSON），自带 CC BY-NC-SA 协议与贡献者。
// 用法：pnpm --filter @harublog/worker exec tsx src/export.ts > harublog-dump.ndjson
import { buildDocumentExport, getDb, listPublishedDocIds } from '@harublog/db';

async function main(): Promise<void> {
  const db = getDb();
  const ids = await listPublishedDocIds(db);
  let n = 0;
  for (const id of ids) {
    const doc = await buildDocumentExport(db, id);
    if (doc !== null) {
      process.stdout.write(`${JSON.stringify(doc)}\n`);
      n++;
    }
  }
  process.stderr.write(`[export] 已导出 ${n} 篇已发布文章（NDJSON）\n`);
}

main().then(
  () => process.exit(0),
  (e) => {
    process.stderr.write(`[export] 失败：${e}\n`);
    process.exit(1);
  },
);
