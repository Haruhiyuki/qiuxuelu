// 无头验证 M4 红线：连接协作网关 → 编辑 Y.Doc → 触发 checkpoint → 查 collab_checkpoint 修订 →
// 断开重连（服务端从修订重建）→ 确认改动仍在。需先起 collab 网关（同一 COLLAB_SECRET）。
// 用法：COLLAB_SECRET=... pnpm --filter @harublog/collab exec tsx scripts/m4-seam-check.mts
import { createHmac } from 'node:crypto';
import { documentRefs, documents, getDb, revisions } from '@harublog/db';
import { COLLAB_FRAGMENT } from '@harublog/editor';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { and, count, eq, like } from 'drizzle-orm';
import { yDocToProsemirrorJSON } from 'y-prosemirror';
import * as Y from 'yjs';

const SECRET = process.env.COLLAB_SECRET ?? 'dev-collab-secret';
const URL = process.env.COLLAB_URL ?? 'ws://localhost:3201';
const db = getDb();

function signToken(userId: string, docId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ userId, name: '缝合验证员', docId, exp: Date.now() + 3_600_000 }),
    'utf8',
  ).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitSynced(provider: HocuspocusProvider): Promise<void> {
  if (provider.synced) return;
  await new Promise<void>((resolve) => {
    const onSynced = () => resolve();
    provider.on('synced', onSynced);
    setTimeout(resolve, 5000); // 兜底
  });
}

async function checkpointCount(docId: string): Promise<number> {
  const r = await db
    .select({ n: count() })
    .from(revisions)
    .where(and(eq(revisions.documentId, docId), eq(revisions.kind, 'collab_checkpoint')));
  return Number(r[0]?.n ?? 0);
}

async function main(): Promise<void> {
  const doc = (
    await db
      .select({ id: documents.id, ownerId: documents.ownerId })
      .from(documents)
      .where(and(like(documents.slug, 'm1-smoke-%'), eq(documents.status, 'published')))
      .limit(1)
  )[0];
  if (!doc) throw new Error('需要一个 m1-smoke 文档（先跑 m1-fixture）');
  // 确保有 draft ref（协作基于草稿）
  const draft = (
    await db
      .select({ revisionId: documentRefs.revisionId })
      .from(documentRefs)
      .where(and(eq(documentRefs.documentId, doc.id), eq(documentRefs.name, 'draft')))
      .limit(1)
  )[0];
  if (!draft) throw new Error('文档缺少 draft ref');

  const token = signToken(doc.ownerId ?? 'm4-user', doc.id);
  const before = await checkpointCount(doc.id);
  const marker = `协作缝合验证-${Date.now()}`;

  // ① 连接 + 同步 + 编辑
  const ydoc1 = new Y.Doc();
  const p1 = new HocuspocusProvider({ url: URL, name: doc.id, token, document: ydoc1 });
  await waitSynced(p1);
  const frag = ydoc1.getXmlFragment(COLLAB_FRAGMENT);
  const para = new Y.XmlElement('paragraph');
  para.setAttribute('blockId', `m4-${Date.now()}`);
  const text = new Y.XmlText();
  text.insert(0, marker);
  para.insert(0, [text]);
  frag.push([para]);

  // 等防抖 checkpoint（debounce 2s）
  await sleep(4000);
  const afterEdit = await checkpointCount(doc.id);

  // ② 断开（触发卸载，下次连接将从修订重建）
  p1.destroy();
  ydoc1.destroy();
  await sleep(1500);

  // ③ 重连 + 同步，确认改动仍在（从 collab_checkpoint 修订重建）
  const ydoc2 = new Y.Doc();
  const p2 = new HocuspocusProvider({ url: URL, name: doc.id, token, document: ydoc2 });
  await waitSynced(p2);
  await sleep(500);
  const json = yDocToProsemirrorJSON(ydoc2, COLLAB_FRAGMENT);
  const reloadedText = JSON.stringify(json);
  p2.destroy();
  ydoc2.destroy();

  console.log(
    `RESULT ${JSON.stringify({
      checkpointBefore: before,
      checkpointAfter: afterEdit,
      checkpointWritten: afterEdit > before,
      markerSurvivedReconnect: reloadedText.includes(marker),
    })}`,
  );
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
