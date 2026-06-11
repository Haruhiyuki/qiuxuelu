// 校验三方合并在真实 revision_blocks 数据上的三条路径（快进/自动变基/冲突）。
// 用法：pnpm --filter @harublog/db exec tsx scripts/m3-merge-check.mts
import { type ManifestEntry, threeWayMerge } from '@harublog/kernel';
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '../src/client';
import { documentRefs, revisionBlocks, suggestions } from '../src/schema/index';

const db = getDb();

async function entriesOf(revisionId: string): Promise<ManifestEntry[]> {
  const rows = await db
    .select({ blockId: revisionBlocks.blockId, hash: revisionBlocks.blobHash })
    .from(revisionBlocks)
    .where(eq(revisionBlocks.revisionId, revisionId))
    .orderBy(asc(revisionBlocks.position));
  return rows.map((r) => ({ blockId: r.blockId, hash: r.hash }));
}

async function main(): Promise<void> {
  const sg = (await db.select().from(suggestions).where(eq(suggestions.status, 'open')).limit(1))[0];
  if (!sg) throw new Error('没有 open 状态的建议，先跑 m3-suggestion-fixture');

  const oursHead = (
    await db
      .select({ revisionId: documentRefs.revisionId })
      .from(documentRefs)
      .where(and(eq(documentRefs.documentId, sg.documentId), eq(documentRefs.name, 'published')))
      .limit(1)
  )[0]?.revisionId;
  if (!oursHead) throw new Error('无发布修订');

  const base = await entriesOf(sg.baseRevisionId);
  const ours = await entriesOf(oursHead);
  const theirs = await entriesOf(sg.headRevisionId);

  // 1) 快进：当前 published 仍是 base（主线未动）
  const ff = threeWayMerge(base, ours, theirs);

  // 2) 自动变基：构造一个「主线前移、改了另一块」的 ours'（与建议改的首块不冲突）
  const oursRebased = ours.map((e, i) =>
    i === ours.length - 1 ? { blockId: e.blockId, hash: `${e.hash}-mainline` } : e,
  );
  const rebase = threeWayMerge(base, oursRebased, theirs);

  // 3) 冲突：主线也改了建议改的同一块（首块），不同内容
  const oursConflict = ours.map((e, i) =>
    i === 0 ? { blockId: e.blockId, hash: `${e.hash}-mainline-conflict` } : e,
  );
  const conflict = threeWayMerge(base, oursConflict, theirs);

  console.log(
    `RESULT ${JSON.stringify({
      fastForward: { ff: ff.fastForward, conflicts: ff.conflicts.length },
      autoRebase: {
        ff: rebase.fastForward,
        conflicts: rebase.conflicts.length,
        // 变基结果应同时包含「主线改的末块」与「建议改的首块」
        hasMainlineEdit: rebase.entries.some((e) => e.hash.endsWith('-mainline')),
        entryCount: rebase.entries.length,
      },
      conflict: {
        conflicts: conflict.conflicts.length,
        conflictBlock: conflict.conflicts[0]?.blockId === base[0]?.blockId,
      },
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
