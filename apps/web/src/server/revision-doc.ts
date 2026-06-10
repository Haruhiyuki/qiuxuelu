import type { Database } from '@harublog/db';
import { blobs, revisionBlocks } from '@harublog/db';
import type { DiffBlockInput } from '@harublog/kernel';
import { extractText, validateDoc } from '@harublog/kernel';
import { asc, eq } from 'drizzle-orm';

/** db 实例与事务句柄的最小公共面：本模块只读，select 足够。 */
export type DbExecutor = Pick<Database, 'select'>;

/**
 * 从 revision_blocks join blobs 重组完整文档 JSON：按 position 排序，把 blocks.id
 * 回填进各块 attrs.blockId（blob 内容是 stripIdentity 后的，身份只活在树表里）。
 * 返回 unknown：是否过 validateDoc 由调用方决定——发布落库前必须验，预览渲染交给
 * ArticleRenderer 内置的容错校验即可（坏数据显示中文占位而非炸页面）。
 */
export async function loadRevisionDoc(executor: DbExecutor, revisionId: string): Promise<unknown> {
  const rows = await executor
    .select({ blockId: revisionBlocks.blockId, content: blobs.content })
    .from(revisionBlocks)
    .innerJoin(blobs, eq(blobs.hash, revisionBlocks.blobHash))
    .where(eq(revisionBlocks.revisionId, revisionId))
    .orderBy(asc(revisionBlocks.position));

  const content = rows.map((row) => {
    const node = (
      typeof row.content === 'object' && row.content !== null ? row.content : {}
    ) as Record<string, unknown>;
    const attrs =
      typeof node.attrs === 'object' && node.attrs !== null
        ? (node.attrs as Record<string, unknown>)
        : {};
    return { ...node, attrs: { ...attrs, blockId: row.blockId } };
  });

  return { type: 'doc', content };
}

/**
 * 加载某修订的有序块清单，供 kernel buildRevisionDiff 使用。
 * 每块返回 { blockId, hash, type, text }：hash 取自树表 blobHash（diff 的等价判定基准），
 * text 由块节点经 extractText 抽取（与搜索/锚点同口径）。坏块降级为空文本不抛错。
 */
export async function loadRevisionBlocks(
  executor: DbExecutor,
  revisionId: string,
): Promise<DiffBlockInput[]> {
  const rows = await executor
    .select({
      blockId: revisionBlocks.blockId,
      hash: revisionBlocks.blobHash,
      content: blobs.content,
    })
    .from(revisionBlocks)
    .innerJoin(blobs, eq(blobs.hash, revisionBlocks.blobHash))
    .where(eq(revisionBlocks.revisionId, revisionId))
    .orderBy(asc(revisionBlocks.position));

  return rows.map((row) => {
    const raw = (
      typeof row.content === 'object' && row.content !== null ? row.content : {}
    ) as Record<string, unknown>;
    const type = typeof raw.type === 'string' ? raw.type : 'paragraph';
    let text = '';
    try {
      // 单块校验：blob 内容是 stripIdentity 后的单节点，补一个占位 blockId 再过 schema
      const attrs =
        typeof raw.attrs === 'object' && raw.attrs !== null
          ? (raw.attrs as Record<string, unknown>)
          : {};
      const doc = validateDoc({
        type: 'doc',
        content: [{ ...raw, attrs: { ...attrs, blockId: row.blockId } }],
      });
      const node = doc.content[0];
      if (node !== undefined) {
        text = extractText(node);
      }
    } catch {
      text = '';
    }
    return { blockId: row.blockId, hash: row.hash, type, text };
  });
}
