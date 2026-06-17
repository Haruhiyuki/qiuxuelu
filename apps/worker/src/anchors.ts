// 行内评论锚点重映射（架构 §3.4）：博客发布新修订后，把已有行内批注锚点重定位到新文本。
// 用 kernel remapAnchorAcrossBlocks：先在原块按五级阶梯重映射，原块没了/找不到再全文找回
// （块被拆分/合并/移动也能跟随）；引文 + 前后文模糊匹配、码点安全；全文都找不到才 orphaned，永不静默丢弃。
import type { Database } from '@harublog/db';
import { blobs, commentAnchors, comments, documentRefs, revisionBlocks } from '@harublog/db';
import { type Anchor, type BlockText, remapAnchorAcrossBlocks } from '@harublog/kernel';
import { and, eq } from 'drizzle-orm';

export interface RemapStats {
  total: number;
  live: number;
  remapped: number;
  orphaned: number;
}

/**
 * 把某博客所有 visible 行内批注的锚点，重映射到其当前发布修订的块文本。
 * 返回统计（用于「锚点存活率 ≥95%」红线核验）。
 */
export async function remapDocumentAnchors(db: Database, docId: string): Promise<RemapStats> {
  const stats: RemapStats = { total: 0, live: 0, remapped: 0, orphaned: 0 };

  const refRows = await db
    .select({ revisionId: documentRefs.revisionId })
    .from(documentRefs)
    .where(and(eq(documentRefs.documentId, docId), eq(documentRefs.name, 'published')))
    .limit(1);
  const publishedRevisionId = refRows[0]?.revisionId;
  if (publishedRevisionId === undefined) {
    return stats;
  }

  // 新发布修订的每块纯文本（跨块找回需要全部块，不只锚点原块）
  const blockRows = await db
    .select({ blockId: revisionBlocks.blockId, text: blobs.textPlain })
    .from(revisionBlocks)
    .innerJoin(blobs, eq(blobs.hash, revisionBlocks.blobHash))
    .where(eq(revisionBlocks.revisionId, publishedRevisionId));
  const blocks: BlockText[] = blockRows.map((b) => ({ blockId: b.blockId, text: b.text ?? '' }));

  // 该文全部 visible 行内批注锚点
  const anchorRows = await db
    .select({
      commentId: commentAnchors.commentId,
      blockId: commentAnchors.blockId,
      startOffset: commentAnchors.startOffset,
      endOffset: commentAnchors.endOffset,
      quotedText: commentAnchors.quotedText,
      prefix: commentAnchors.prefix,
      suffix: commentAnchors.suffix,
    })
    .from(commentAnchors)
    .innerJoin(comments, eq(comments.id, commentAnchors.commentId))
    .where(
      and(
        eq(comments.documentId, docId),
        eq(comments.kind, 'inline'),
        eq(comments.status, 'visible'),
      ),
    );

  for (const a of anchorRows) {
    stats.total++;
    const anchor: Anchor & { blockId: string } = {
      blockId: a.blockId,
      startOffset: a.startOffset ?? 0,
      endOffset: a.endOffset ?? 0,
      quotedText: a.quotedText,
      prefix: a.prefix ?? undefined,
      suffix: a.suffix ?? undefined,
    };
    const result = remapAnchorAcrossBlocks(anchor, blocks);
    if (result.state === 'orphaned') {
      // 全文都找不到 → 失锚（保留原 blockId / 引文 / 上下文，下次发布仍会重试，文本回来即可复活）
      await db
        .update(commentAnchors)
        .set({ state: 'orphaned', revisionId: publishedRevisionId })
        .where(eq(commentAnchors.commentId, a.commentId));
      stats.orphaned++;
      continue;
    }
    // 命中：连同 blockId（可能跨块）、命中文本（令锚点随演化收敛）、刷新的上下文一并落库
    await db
      .update(commentAnchors)
      .set({
        blockId: result.blockId,
        startOffset: result.startOffset,
        endOffset: result.endOffset,
        quotedText: result.matchedText ?? a.quotedText,
        prefix: result.prefix ?? null,
        suffix: result.suffix ?? null,
        state: result.state,
        revisionId: publishedRevisionId,
      })
      .where(eq(commentAnchors.commentId, a.commentId));
    if (result.state === 'live') stats.live++;
    else stats.remapped++;
  }

  return stats;
}
