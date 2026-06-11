// harublog 协作网关：Hocuspocus（Yjs over WebSocket）。
// 鉴权用 web 签发的短期协作 token（授权 owner/editor/TL4 已在 web 完成，此处只验签 + 校验 docId）。
// onLoadDocument 从草稿修订种 Y.Doc；onStoreDocument 防抖把 Y.Doc 快照为 collab_checkpoint 修订（缝合层）。
import { getDb } from '@harublog/db';
import { Server } from '@hocuspocus/server';
import { writeCheckpoint } from './checkpoint';
import { seedYDoc } from './seed';
import { verifyCollabToken } from './token';

const PORT = Number(process.env.COLLAB_PORT ?? 3201);
const SECRET = process.env.COLLAB_SECRET ?? '';
if (SECRET.length === 0) {
  console.warn('[collab] 未设置 COLLAB_SECRET：所有连接都会被拒绝');
}

const db = getDb();

const server = new Server({
  port: PORT,
  // 鉴权：token 由 web issueCollabToken 签发，必须与所连文档（documentName=docId）一致
  async onAuthenticate({ token, documentName }) {
    const claims = verifyCollabToken(token, SECRET);
    if (claims === null || claims.docId !== documentName) {
      throw new Error('未授权的协作连接');
    }
    // 返回值进入连接 context，供 awareness/审计使用
    return { userId: claims.userId, name: claims.name };
  },

  // 文档载入：始终从草稿修订重建（修订是真相，Yjs 二进制不持久化）
  async onLoadDocument({ documentName, document }) {
    await seedYDoc(db, documentName, document);
    return document;
  },

  // 防抖落盘：把当前 Y.Doc 快照为一次 collab_checkpoint 修订
  async onStoreDocument({ documentName, document }) {
    try {
      const result = await writeCheckpoint(db, documentName, document);
      if (result.changed) {
        console.log(`[collab] checkpoint ${documentName} → 第 ${result.seq} 号修订`);
      }
    } catch (err) {
      // 缝合失败不应中断会话：记录后等待下次 store 重试（Y.Doc 仍是当前真相）
      console.error(`[collab] checkpoint ${documentName} 失败：`, err);
    }
  },

  // 落盘防抖：编辑停顿 2s 或最长 10s 触发一次 store
  debounce: 2000,
  maxDebounce: 10000,
});

server.listen().then(
  () => console.log(`[collab] Hocuspocus 网关已启动：ws://localhost:${PORT}`),
  (err: unknown) => {
    console.error('[collab] 启动失败：', err);
    process.exit(1);
  },
);
