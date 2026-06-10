// 编辑器侧块身份（nanoid）→ 库内块身份（blocks.id 为 uuid 列）的适配层。
// db schema 把块主键定为 uuid 且没有冗余列存编辑器 id，因此用 UUIDv5（SHA-1，命名空间
// = 文档 uuid）做确定性派生：同一文档内同一 nanoid 永远映射到同一 uuid——
// 这是跨修订块身份稳定（diff/blame/锚点的根基）的前提，改动派生规则等同重置全站块身份。
import { createHash } from 'node:crypto';
import type { ManifestEntry } from '@harublog/kernel';
import { canonicalize } from '@harublog/kernel';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidV5(namespaceUuid: string, name: string): string {
  const ns = Buffer.from(namespaceUuid.replaceAll('-', ''), 'hex');
  const digest = createHash('sha1').update(ns).update(name, 'utf8').digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * 编辑器 blockId → blocks.id。已是 uuid 形（来自快照回灌等读路径）则原样沿用，
 * 保证「working copy 丢失后从快照重建」不引发全量换身份。
 */
export function toDbBlockId(documentId: string, editorBlockId: string): string {
  if (UUID_RE.test(editorBlockId)) {
    return editorBlockId.toLowerCase();
  }
  return uuidV5(documentId, editorBlockId);
}

/** 修订树清单哈希（revisions.manifest_hash）：对换算为库内 id 的有序清单做 canonicalize 后 sha256。 */
export function hashManifest(entries: readonly ManifestEntry[]): string {
  return createHash('sha256').update(canonicalize(entries), 'utf8').digest('hex');
}
