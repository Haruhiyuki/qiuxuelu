import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import { CANON_VERSION, canonicalize, hashBlock, stripIdentity } from '../src/canon/index';
import type { BlockNode, BlockquoteNode, ParagraphNode } from '../src/schema/index';

function p(blockId: string, text: string): ParagraphNode {
  return { type: 'paragraph', attrs: { blockId }, content: [{ type: 'text', text }] };
}

describe('canon/canonicalize', () => {
  it('版本号锁定为 1', () => {
    expect(CANON_VERSION).toBe(1);
  });

  it('对象键序无关：不同构造顺序产生同一规范串', () => {
    const a = { b: 1, a: 'x', c: [{ z: true, y: 2 }] };
    const b = { c: [{ y: 2, z: true }], a: 'x', b: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(canonicalize(a)).toBe('{"a":"x","b":1,"c":[{"y":2,"z":true}]}');
  });

  it('字符串 NFC 归一化：组合字符与预组合字符等价', () => {
    // 'café'：é 是预组合，e+́ 是组合序列
    expect(canonicalize('café')).toBe(canonicalize('café'));
    expect(canonicalize({ t: 'café' })).toBe('{"t":"café"}');
  });

  it('剔除 null/undefined 值与空 attrs 对象', () => {
    expect(canonicalize({ a: 1, b: null, c: undefined })).toBe('{"a":1}');
    expect(canonicalize({ type: 'divider', attrs: {} })).toBe('{"type":"divider"}');
    // 非 attrs 键的空对象保留（只有 attrs 有「空壳即无」语义）
    expect(canonicalize({ meta: {} })).toBe('{"meta":{}}');
  });
});

describe('canon/stripIdentity', () => {
  it('递归剥离 attrs.blockId（含嵌套子段落），保留其余 attrs，且不改原对象', () => {
    const node: BlockquoteNode = {
      type: 'blockquote',
      attrs: { blockId: 'bq-1' },
      content: [
        {
          type: 'paragraph',
          attrs: { blockId: 'inner-1' },
          content: [{ type: 'text', text: '引文' }],
        },
      ],
    };
    const stripped = stripIdentity(node);
    expect(stripped).toEqual({
      type: 'blockquote',
      attrs: {},
      content: [{ type: 'paragraph', attrs: {}, content: [{ type: 'text', text: '引文' }] }],
    });
    // 原对象未被修改（深拷贝）
    expect(node.attrs.blockId).toBe('bq-1');
    expect(node.content[0]?.attrs?.blockId).toBe('inner-1');
  });

  it('保留 blockId 之外的 attrs 字段', () => {
    const heading: BlockNode = {
      type: 'heading',
      attrs: { blockId: 'h-1', level: 3 },
      content: [{ type: 'text', text: '标题' }],
    };
    expect(stripIdentity(heading)).toEqual({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: '标题' }],
    });
  });

  it('不误删正文里名为 blockId 的键（只处理 attrs 内部）', () => {
    const weird = { type: 'x', blockId: 'keep-me', attrs: { blockId: 'drop-me', other: 1 } };
    expect(stripIdentity(weird)).toEqual({ type: 'x', blockId: 'keep-me', attrs: { other: 1 } });
  });
});

describe('canon/hashBlock', () => {
  it('blockId 不同、内容相同 → 哈希相等（身份不参与寻址）', () => {
    expect(hashBlock(p('id-aaa', '同一段内容'))).toBe(hashBlock(p('id-bbb', '同一段内容')));
  });

  it('内容不同 → 哈希不等', () => {
    expect(hashBlock(p('id-1', '内容甲'))).not.toBe(hashBlock(p('id-1', '内容乙')));
  });

  it('键序与 NFC 差异不影响哈希', () => {
    const a: ParagraphNode = {
      type: 'paragraph',
      attrs: { blockId: 'x' },
      content: [{ type: 'text', text: 'café' }],
    };
    const b: ParagraphNode = {
      content: [{ text: 'café', type: 'text' }],
      attrs: { blockId: 'y' },
      type: 'paragraph',
    };
    expect(hashBlock(a)).toBe(hashBlock(b));
  });

  it('输出 64 位十六进制，且等于规范串的 sha256（钉死 v1 管线语义）', () => {
    const divider: BlockNode = { type: 'divider', attrs: { blockId: 'd-1' } };
    const hash = hashBlock(divider);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // 规范串字面量被钉死：strip 后 attrs 为空被剔除
    const pinnedCanon = '{"type":"divider"}';
    expect(canonicalize(stripIdentity(divider))).toBe(pinnedCanon);
    expect(hash).toBe(bytesToHex(sha256(utf8ToBytes(pinnedCanon))));
  });

  it('钉死中文段落的规范串形态', () => {
    const node = p('p-1', '你好');
    expect(canonicalize(stripIdentity(node))).toBe(
      '{"content":[{"text":"你好","type":"text"}],"type":"paragraph"}',
    );
  });
});
