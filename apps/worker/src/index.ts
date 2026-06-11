// harublog worker：消费 search_outbox（事务性 outbox 模式）。发布事件 → ① 同步 Meilisearch
// ② 重映射行内批注锚点（架构 §3.4）。设计取舍：outbox 表本身即持久可重放队列，故直接轮询而非
// 引入 pg-boss——pg-boss 留给后续真·异步作业（邮件摘要等）。索引/锚点均可从 PG 重放。
import { getDb } from '@harublog/db';
import { ensureBlocksIndex } from '@harublog/search';
import { sql } from 'drizzle-orm';
import { remapDocumentAnchors } from './anchors';
import { syncDocument } from './sync';

const POLL_INTERVAL_MS = 2000;
const BATCH_SIZE = 50;

interface OutboxRow {
  id: string;
  topic: string;
  payload: { docId?: string } | null;
}

let stopping = false;

async function drainOnce(): Promise<number> {
  const db = getDb();
  // FOR UPDATE SKIP LOCKED：多 worker 并发安全；只取未处理行
  const rows = (await db.execute(sql`
    select id, topic, payload
    from search_outbox
    where processed_at is null
    order by id asc
    limit ${BATCH_SIZE}
    for update skip locked
  `)) as unknown as OutboxRow[];

  for (const row of rows) {
    const docId = row.payload?.docId;
    try {
      if (
        docId !== undefined &&
        (row.topic === 'doc.published' || row.topic === 'doc.unpublished')
      ) {
        await syncDocument(db, docId);
        if (row.topic === 'doc.published') {
          const remap = await remapDocumentAnchors(db, docId);
          if (remap.total > 0) {
            console.log(
              `[worker] 锚点重映射 ${docId}：live ${remap.live} / remapped ${remap.remapped} / orphaned ${remap.orphaned}`,
            );
          }
        }
      }
      // 未知主题也标记已处理，避免毒丸卡队列（已 log 警告）
      else if (docId === undefined) {
        console.warn(`[worker] outbox#${row.id} 主题 ${row.topic} 缺 docId，跳过`);
      }
      await db.execute(sql`update search_outbox set processed_at = now() where id = ${row.id}`);
    } catch (err) {
      // 处理失败：不标记，下轮重试（log 后继续处理其它行）
      console.error(`[worker] 处理 outbox#${row.id}(${row.topic}) 失败：`, err);
    }
  }
  return rows.length;
}

async function main(): Promise<void> {
  console.log('[worker] 启动；连接 Meilisearch 并确保索引…');
  await ensureBlocksIndex();
  console.log('[worker] blocks 索引就绪，开始轮询 search_outbox');

  while (!stopping) {
    let processed = 0;
    try {
      processed = await drainOnce();
    } catch (err) {
      console.error('[worker] 轮询出错：', err);
    }
    // 有积压则立即继续，空闲则歇一会
    if (processed === 0) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`[worker] 收到 ${sig}，准备退出…`);
    stopping = true;
  });
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('[worker] 致命错误：', err);
    process.exit(1);
  },
);
