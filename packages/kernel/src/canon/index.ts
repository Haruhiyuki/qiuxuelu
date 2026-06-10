import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import type { BlockNode } from '../schema/index';

/** 规范化算法版本；canonicalize/stripIdentity 任一语义变化都必须递增（哈希语义随其变化，ADR-0003）。 */
export const CANON_VERSION = 1;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepStrip(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(deepStrip);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === 'attrs' && isPlainObject(child)) {
        const attrs: Record<string, unknown> = {};
        for (const [attrKey, attrValue] of Object.entries(child)) {
          // 只剥 attrs 内的 blockId，避免误伤恰好叫 blockId 的正文键。
          if (attrKey === 'blockId') continue;
          attrs[attrKey] = deepStrip(attrValue);
        }
        out[key] = attrs;
        continue;
      }
      out[key] = deepStrip(child);
    }
    return out;
  }
  return value;
}

/**
 * 深拷贝并递归移除所有 attrs.blockId。
 * 块身份是外在属性，不参与内容寻址——这是 blob 跨块/跨文档去重的前提。
 * 注：返回值类型上保留 T 形状，运行时 blockId 已不存在，调用方不得再读它。
 */
export function stripIdentity<T>(node: T): T {
  return deepStrip(node) as T;
}

function canonValue(value: unknown): unknown {
  if (typeof value === 'string') {
    // NFC 归一化：保证「café」的组合/预组合两种编码哈希一致。
    return value.normalize('NFC');
  }
  if (value === null || value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    // 数组元素携带位置语义：null/undefined 保位为 null（与 JSON.stringify 语义一致），
    // 否则 [null,1] 与 [1] 会哈希别名。
    return value.map((item) => {
      const canon = canonValue(item);
      return canon === undefined ? null : canon;
    });
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    // 键先 NFC 再按码元字典序排序——若排序先于归一化，NFD/NFC 等价对象会序列化出不同键序、
    // 产生不同哈希；归一化后撞名说明输入本身含等价异码键，静默覆盖即数据丢失，必须拒绝。
    const keyPairs = Object.keys(value).map((raw) => [raw.normalize('NFC'), raw] as const);
    keyPairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const [nfcKey, rawKey] of keyPairs) {
      if (nfcKey in out) {
        throw new Error(`规范化失败：对象存在 NFC 等价的重复键「${nfcKey}」`);
      }
      const canon = canonValue(value[rawKey]);
      if (canon === undefined) continue;
      // stripIdentity 之后 attrs 可能只剩空壳；空 attrs 与无 attrs 必须同哈希。
      if (nfcKey === 'attrs' && isPlainObject(canon) && Object.keys(canon).length === 0) continue;
      out[nfcKey] = canon;
    }
    return out;
  }
  return value;
}

function deepNfc(value: unknown): unknown {
  if (typeof value === 'string') return value.normalize('NFC');
  if (Array.isArray(value)) return value.map(deepNfc);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key.normalize('NFC')] = deepNfc(child);
    }
    return out;
  }
  return value;
}

/**
 * 深度 NFC 归一化（字符串值与对象键）。
 * 入库的 blob 内容必须先经此函数——哈希是对 NFC 形式计算的，若存储跳过归一化，
 * 同一哈希就可能对应不同字节内容，内容寻址的「内容相同 ⇔ 哈希相同」不变式被破坏。
 */
export function normalizeNfc<T>(value: T): T {
  return deepNfc(value) as T;
}

/**
 * 规范化序列化：递归键排序 + 字符串 NFC + 剔除 null/undefined 值与空 attrs 对象后 JSON.stringify。
 * 这是内容寻址哈希的唯一输入形式（CANON_VERSION 锁定其语义）。
 */
export function canonicalize(value: unknown): string {
  const canon = canonValue(value);
  return JSON.stringify(canon === undefined ? null : canon);
}

/** 单块内容哈希：sha256hex(canonicalize(stripIdentity(node)))。用 @noble/hashes 以便内核可进浏览器。 */
export function hashBlock(node: BlockNode): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalize(stripIdentity(node)))));
}
