// 锁死块身份派生（架构红线：改动派生规则等同重置全站块身份）。
// toDbBlockId 必须：同文档同 nanoid → 同 uuid（确定性）、跨文档隔离、已是 uuid 则原样（小写）。
import { describe, expect, it } from 'vitest';
import { hashManifest, toDbBlockId } from './block-identity';

const DOC_A = '11111111-1111-1111-1111-111111111111';
const DOC_B = '22222222-2222-2222-2222-222222222222';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('toDbBlockId', () => {
  it('确定性：同文档同 nanoid 永远映射同一 uuid', () => {
    const a = toDbBlockId(DOC_A, 'nano123');
    const b = toDbBlockId(DOC_A, 'nano123');
    expect(a).toBe(b);
    expect(a).toMatch(UUID_RE);
  });

  it('跨文档隔离：同 nanoid 在不同文档下得到不同 uuid', () => {
    expect(toDbBlockId(DOC_A, 'nano123')).not.toBe(toDbBlockId(DOC_B, 'nano123'));
  });

  it('已是 uuid 形则原样沿用（小写归一），保证快照回灌不换身份', () => {
    const existing = '0190AAAA-bbbb-cccc-dddd-eeeeeeeeeeee';
    expect(toDbBlockId(DOC_A, existing)).toBe(existing.toLowerCase());
  });

  it('不同 nanoid 映射到不同 uuid', () => {
    expect(toDbBlockId(DOC_A, 'x')).not.toBe(toDbBlockId(DOC_A, 'y'));
  });
});

describe('hashManifest', () => {
  const m1 = [
    { blockId: 'b1', hash: 'h1' },
    { blockId: 'b2', hash: 'h2' },
  ];

  it('稳定：相同清单得到相同哈希（sha256 hex）', () => {
    expect(hashManifest(m1)).toBe(hashManifest([...m1]));
    expect(hashManifest(m1)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('顺序敏感：调换块顺序哈希改变（位置是修订树的一部分）', () => {
    expect(hashManifest(m1)).not.toBe(hashManifest([m1[1], m1[0]] as typeof m1));
  });

  it('内容敏感：任一 hash 变化则清单哈希变化', () => {
    expect(hashManifest(m1)).not.toBe(
      hashManifest([
        { blockId: 'b1', hash: 'h1' },
        { blockId: 'b2', hash: 'X' },
      ]),
    );
  });
});
