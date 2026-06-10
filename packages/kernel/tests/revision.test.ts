import { describe, expect, it } from 'vitest';
import { hashBlock } from '../src/canon/index';
import type { BlockChange, ManifestEntry } from '../src/revision/index';
import { buildManifest, diffManifests, extractText } from '../src/revision/index';
import type { DocJson, ParagraphNode } from '../src/schema/index';

function p(blockId: string, text: string): ParagraphNode {
  return { type: 'paragraph', attrs: { blockId }, content: [{ type: 'text', text }] };
}

/** 用假 hash 直接捏清单：diff/merge 只看 blockId+hash，不必构造真实文档。 */
function m(...pairs: Array<[string, string]>): ManifestEntry[] {
  return pairs.map(([blockId, hash]) => ({ blockId, hash }));
}

describe('revision/buildManifest', () => {
  it('entries 保持文档顺序；同内容块在 blobs 中去重；blob 已剥离 blockId', () => {
    const doc: DocJson = { type: 'doc', content: [p('a', '同文'), p('b', '异文'), p('c', '同文')] };
    const { entries, blobs } = buildManifest(doc);

    expect(entries.map((e) => e.blockId)).toEqual(['a', 'b', 'c']);
    expect(entries[0]?.hash).toBe(hashBlock(p('whatever', '同文')));
    // a 与 c 同内容 → 同 hash → blobs 只有两份
    expect(entries[0]?.hash).toBe(entries[2]?.hash);
    expect(blobs.size).toBe(2);

    const blob = blobs.get(entries[0]?.hash as string);
    expect(blob).toEqual({
      type: 'paragraph',
      attrs: {},
      content: [{ type: 'text', text: '同文' }],
    });
  });
});

describe('revision/diffManifests', () => {
  it('纯新增', () => {
    const changes = diffManifests(m(['A', 'hA']), m(['A', 'hA'], ['B', 'hB']));
    expect(changes).toEqual<BlockChange[]>([{ kind: 'add', blockId: 'B', hash: 'hB', pos: 1 }]);
  });

  it('纯删除', () => {
    const changes = diffManifests(m(['A', 'hA'], ['B', 'hB']), m(['A', 'hA']));
    expect(changes).toEqual<BlockChange[]>([
      { kind: 'remove', blockId: 'B', oldHash: 'hB', oldPos: 1 },
    ]);
  });

  it('纯修改', () => {
    const changes = diffManifests(m(['A', 'hA'], ['B', 'hB']), m(['A', 'hA2'], ['B', 'hB']));
    expect(changes).toEqual<BlockChange[]>([
      { kind: 'modify', blockId: 'A', oldHash: 'hA', newHash: 'hA2', oldPos: 0, pos: 0 },
    ]);
  });

  it('LIS 最小化：[A,B,C,D]→[B,C,D,A] 只产生 1 个 move', () => {
    const base = m(['A', 'hA'], ['B', 'hB'], ['C', 'hC'], ['D', 'hD']);
    const head = m(['B', 'hB'], ['C', 'hC'], ['D', 'hD'], ['A', 'hA']);
    expect(diffManifests(base, head)).toEqual<BlockChange[]>([
      { kind: 'move', blockId: 'A', hash: 'hA', oldPos: 0, pos: 3 },
    ]);
  });

  it('三块倒序需要 2 个 move（理论最小值）', () => {
    const base = m(['A', 'hA'], ['B', 'hB'], ['C', 'hC']);
    const head = m(['C', 'hC'], ['B', 'hB'], ['A', 'hA']);
    const changes = diffManifests(base, head);
    expect(changes.filter((c) => c.kind === 'move')).toHaveLength(2);
    expect(changes).toHaveLength(2);
  });

  it('修改且移动只记 modify（pos 已表达移动），不重复发 move', () => {
    const base = m(['A', 'hA'], ['B', 'hB'], ['C', 'hC']);
    const head = m(['B', 'hB'], ['A', 'hA2'], ['C', 'hC']);
    expect(diffManifests(base, head)).toEqual<BlockChange[]>([
      { kind: 'modify', blockId: 'A', oldHash: 'hA', newHash: 'hA2', oldPos: 0, pos: 1 },
    ]);
  });

  it('组合场景：删除 + 修改换位 + 新增，未修改块零 move', () => {
    const base = m(['A', 'hA'], ['B', 'hB'], ['C', 'hC'], ['D', 'hD'], ['E', 'hE']);
    const head = m(['A', 'hA'], ['C', 'hC2'], ['F', 'hF'], ['B', 'hB'], ['E', 'hE']);
    // A/B/E 相对顺序未破坏（重排归因于被修改的 C），最小 move 数为 0
    expect(diffManifests(base, head)).toEqual<BlockChange[]>([
      { kind: 'remove', blockId: 'D', oldHash: 'hD', oldPos: 3 },
      { kind: 'modify', blockId: 'C', oldHash: 'hC', newHash: 'hC2', oldPos: 2, pos: 1 },
      { kind: 'add', blockId: 'F', hash: 'hF', pos: 2 },
    ]);
  });

  it('双方为空与完全相同清单都产生空 diff', () => {
    expect(diffManifests([], [])).toEqual([]);
    const same = m(['A', 'hA'], ['B', 'hB']);
    expect(diffManifests(same, m(['A', 'hA'], ['B', 'hB']))).toEqual([]);
  });
});

describe('revision/extractText', () => {
  it('行内直接拼接不加空格，hard_break 记换行', () => {
    const node: ParagraphNode = {
      type: 'paragraph',
      attrs: { blockId: 'p' },
      content: [
        { type: 'text', text: '高考', marks: [{ type: 'bold' }] },
        { type: 'text', text: '前夜' },
        { type: 'hard_break' },
        { type: 'text', text: '失眠了' },
      ],
    };
    expect(extractText(node)).toBe('高考前夜\n失眠了');
  });

  it('块内段落间以换行分隔（blockquote/列表）', () => {
    expect(
      extractText({
        type: 'blockquote',
        attrs: { blockId: 'q' },
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '上句' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '下句' }] },
        ],
      }),
    ).toBe('上句\n下句');

    expect(
      extractText({
        type: 'bullet_list',
        attrs: { blockId: 'l' },
        content: [
          {
            type: 'list_item',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '甲' }] }],
          },
          {
            type: 'list_item',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '乙' }] }],
          },
        ],
      }),
    ).toBe('甲\n乙');
  });

  it('code_block / figure / math_block / divider 的抽取规则', () => {
    expect(
      extractText({
        type: 'code_block',
        attrs: { blockId: 'c' },
        content: [{ type: 'text', text: 'let a = 1;' }],
      }),
    ).toBe('let a = 1;');
    expect(
      extractText({ type: 'figure', attrs: { blockId: 'f', src: '/x.png', alt: '替代文本' } }),
    ).toBe('替代文本');
    expect(
      extractText({
        type: 'figure',
        attrs: { blockId: 'f2', src: '/x.png', alt: '替代文本', caption: '图注优先' },
      }),
    ).toBe('图注优先');
    expect(extractText({ type: 'math_block', attrs: { blockId: 'm', latex: 'E=mc^2' } })).toBe(
      'E=mc^2',
    );
    expect(extractText({ type: 'divider', attrs: { blockId: 'd' } })).toBe('');
  });

  it('整篇文档抽取：块间换行', () => {
    const doc: DocJson = { type: 'doc', content: [p('a', '第一段'), p('b', '第二段')] };
    expect(extractText(doc)).toBe('第一段\n第二段');
  });
});
