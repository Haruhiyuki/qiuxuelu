// 并发修订三方合并的共享基础设施（ADR-0012）：mergeSuggestion / commitRevision / directEditPublished 共用。
// 内容合并交给 kernel threeWayMerge（纯函数、已测）；这里只放 DB 取 entries、应用裁决、冲突视图。
import { blobs, type getDb, revisionBlocks } from '@harublog/db';
import type { ManifestEntry, MergeConflict } from '@harublog/kernel';
import { asc, eq, inArray } from 'drizzle-orm';

/** 逐块裁决：blockId → 保留哪一侧。 */
export type ConflictResolutions = Record<string, 'ours' | 'theirs'>;

/** 冲突的哈希级视图（与 kernel MergeConflict 同形，前后端传递用）。 */
export interface ConflictView {
  blockId: string;
  baseHash: string | null;
  oursHash: string | null;
  theirsHash: string | null;
}

/** 直接提交冲突的文本级视图（带双方纯文本，前端三栏裁决直接展示，无需按 hash 回查）。 */
export interface CommitConflictView {
  blockId: string;
  /** 你的版本（工作副本）；该侧已删则为 null */
  oursText: string | null;
  /** 当前版本（其他会话已提交的）；该侧已删则为 null */
  theirsText: string | null;
}

/** 直接提交的结果：成功落一条修订（merged 标记是否做了三方合并，前端据此决定是否重载编辑器），
 *  或撞真冲突需逐块裁决后重交。 */
export type CommitOutcome =
  | { committed: true; seq: number; merged: boolean }
  | { committed: false; conflicts: CommitConflictView[] };

/** 把裁决应用到合并结果 entries 上：both-modified→换 hash；删/改→按选择增删。 */
export function applyResolutions(
  entries: ManifestEntry[],
  conflicts: MergeConflict[],
  resolutions: ConflictResolutions,
): ManifestEntry[] {
  const out = entries.map((e) => ({ ...e }));
  for (const c of conflicts) {
    const choice = resolutions[c.blockId];
    const chosenHash = choice === 'theirs' ? c.theirsHash : c.oursHash;
    const idx = out.findIndex((e) => e.blockId === c.blockId);
    if (chosenHash === null) {
      if (idx >= 0) out.splice(idx, 1);
    } else if (idx >= 0) {
      const cur = out[idx];
      if (cur !== undefined) cur.hash = chosenHash;
    } else {
      out.push({ blockId: c.blockId, hash: chosenHash });
    }
  }
  return out;
}

type Selectable = Pick<ReturnType<typeof getDb>, 'select'>;

/** 取某修订的 manifest entries（按 position 序）。 */
export async function entriesOf(tx: Selectable, revisionId: string): Promise<ManifestEntry[]> {
  const rows = await tx
    .select({ blockId: revisionBlocks.blockId, hash: revisionBlocks.blobHash })
    .from(revisionBlocks)
    .where(eq(revisionBlocks.revisionId, revisionId))
    .orderBy(asc(revisionBlocks.position));
  return rows.map((r) => ({ blockId: r.blockId, hash: r.hash }));
}

/** 批量取 blob 纯文本（按 hash）。用于冲突块「你的版本 / 当前版本」文本展示。 */
export async function textByHashes(
  tx: Selectable,
  hashes: Iterable<string>,
): Promise<Map<string, string>> {
  const list = [...new Set(hashes)];
  if (list.length === 0) {
    return new Map();
  }
  const rows = await tx
    .select({ hash: blobs.hash, text: blobs.textPlain })
    .from(blobs)
    .where(inArray(blobs.hash, list));
  return new Map(rows.map((r) => [r.hash, r.text]));
}
