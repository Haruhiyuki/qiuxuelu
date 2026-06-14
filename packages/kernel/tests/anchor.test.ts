import { describe, expect, it } from 'vitest';
import type { Anchor, BlockText, RemapResult } from '../src/anchor/index';
import { makeAnchor, remapAnchor, remapAnchorAcrossBlocks } from '../src/anchor/index';

describe('anchor/makeAnchor', () => {
  it('截取引文与前后各 ctxLen 字符上下文', () => {
    const text = '初三那年的中考，是我第一次真正意义上的大考。';
    const anchor = makeAnchor(text, 5, 7, 4); // '中考'
    expect(anchor).toEqual<Anchor>({
      startOffset: 5,
      endOffset: 7,
      quotedText: '中考',
      prefix: '三那年的',
      suffix: '，是我第',
    });
  });

  it('文本边界处 prefix/suffix 自然截断或省略', () => {
    const text = '中考改变了我';
    const head = makeAnchor(text, 0, 2, 8);
    expect(head).toEqual<Anchor>({
      startOffset: 0,
      endOffset: 2,
      quotedText: '中考',
      suffix: '改变了我',
    });
    const tail = makeAnchor(text, 4, 6, 2);
    expect(tail).toEqual<Anchor>({
      startOffset: 4,
      endOffset: 6,
      quotedText: '了我',
      prefix: '改变',
    });
  });

  it('非法区间（空区间/越界/非整数）抛错', () => {
    expect(() => makeAnchor('文本', 1, 1)).toThrowError(/锚点区间非法/);
    expect(() => makeAnchor('文本', -1, 1)).toThrowError(/锚点区间非法/);
    expect(() => makeAnchor('文本', 0, 3)).toThrowError(/锚点区间非法/);
    expect(() => makeAnchor('文本', 0.5, 1)).toThrowError(/锚点区间非法/);
  });
});

describe('anchor/remapAnchor', () => {
  it('① 原位命中 → live，偏移原样返回', () => {
    const text = '那个九月我转学了。';
    const anchor = makeAnchor(text, 0, 4); // '那个九月'
    expect(remapAnchor(anchor, text)).toEqual<RemapResult>({
      startOffset: 0,
      endOffset: 4,
      state: 'live',
      matchedText: '那个九月',
    });
  });

  it('② 整体平移（前文插入）→ 全文唯一精确匹配 → remapped', () => {
    const anchor = makeAnchor('那个九月我转学了。', 0, 4); // '那个九月'
    const newText = '开学前夜。那个九月我转学了。';
    expect(remapAnchor(anchor, newText)).toEqual<RemapResult>({
      startOffset: 5,
      endOffset: 9,
      state: 'remapped',
      matchedText: '那个九月',
    });
  });

  it('③ 多处匹配 → prefix/suffix 消歧，取前后文吻合度最高者', () => {
    const oldText = '他的成绩一般，但她的成绩拔尖。';
    const anchor = makeAnchor(oldText, 10, 12, 3); // 第二个'成绩'，prefix='但她的'，suffix='拔尖。'
    // 前文改写导致偏移失效，但两处'成绩'都还在
    const newText = '他的成绩一直平平，但她的成绩拔尖。';
    expect(remapAnchor(anchor, newText)).toEqual<RemapResult>({
      startOffset: 12,
      endOffset: 14,
      state: 'remapped',
      matchedText: '成绩',
    });
  });

  it('③ 多处匹配无上下文可用时，同分取离原偏移最近者', () => {
    const anchor: Anchor = { startOffset: 5, endOffset: 7, quotedText: '成绩' };
    const newText = '成绩很重要，成绩不是一切。'; // 匹配位于 0 与 6
    expect(remapAnchor(anchor, newText)).toEqual<RemapResult>({
      startOffset: 6,
      endOffset: 8,
      state: 'remapped',
      matchedText: '成绩',
    });
  });

  it('④ 无精确匹配 → 滑窗模糊匹配（替换一字，Dice=0.8）→ remapped', () => {
    const anchor: Anchor = { startOffset: 0, endOffset: 11, quotedText: '那年高考前夜我彻夜难眠' };
    const newText = '序言。那年高考前夕我彻夜难眠，后来如何。'; // '前夜'→'前夕'
    expect(remapAnchor(anchor, newText)).toEqual<RemapResult>({
      startOffset: 3,
      endOffset: 14,
      state: 'remapped',
      matchedText: '那年高考前夕我彻夜难眠',
    });
  });

  it('④ 模糊匹配允许窗长伸缩（插入一字后命中更长窗口）', () => {
    const anchor: Anchor = { startOffset: 0, endOffset: 8, quotedText: '高三最后一个夏天' };
    const newText = '回忆里，高三最后的一个夏天格外漫长。'; // 插入'的'
    expect(remapAnchor(anchor, newText)).toEqual<RemapResult>({
      startOffset: 4,
      endOffset: 13,
      state: 'remapped',
      matchedText: '高三最后的一个夏天',
    });
  });

  it('⑤ 彻底失锚 → orphaned，偏移返回原值', () => {
    const anchor: Anchor = {
      startOffset: 5,
      endOffset: 10,
      quotedText: '中考录取线',
      prefix: '当年的',
    };
    const newText = '完全无关的另一段文字。';
    expect(remapAnchor(anchor, newText)).toEqual<RemapResult>({
      startOffset: 5,
      endOffset: 10,
      state: 'orphaned',
    });
  });

  it('⑤ 相似度低于 0.75 阈值时宁可失锚也不错贴', () => {
    const anchor: Anchor = { startOffset: 0, endOffset: 4, quotedText: '物理竞赛' };
    // '物理'有重叠但整体 Dice 不足（'物理竞赛' bigram：物理/理竞/竞赛，仅'物理'命中 → 2/6 < 0.75）
    const newText = '我去参加了物理课代表的竞选。';
    expect(remapAnchor(anchor, newText)).toEqual<RemapResult>({
      startOffset: 0,
      endOffset: 4,
      state: 'orphaned',
    });
  });

  it('空引文直接判 orphaned（无法重映射）', () => {
    const anchor: Anchor = { startOffset: 3, endOffset: 3, quotedText: '' };
    expect(remapAnchor(anchor, '任意文本')).toEqual<RemapResult>({
      startOffset: 3,
      endOffset: 3,
      state: 'orphaned',
    });
  });
});

describe('anchor/remapAnchorAcrossBlocks', () => {
  // 引文「错题本」锚点：原块 b1，offsets 2-5
  const base: Anchor & { blockId: string } = {
    blockId: 'b1',
    startOffset: 2,
    endOffset: 5,
    quotedText: '错题本',
    prefix: '我的',
    suffix: '一直',
  };

  it('原块仍在且引文未动 → 留原块、live', () => {
    const blocks: BlockText[] = [
      { blockId: 'b1', text: '我的错题本一直陪着我' },
      { blockId: 'b2', text: '另一段无关文字' },
    ];
    const r = remapAnchorAcrossBlocks(base, blocks);
    expect(r.blockId).toBe('b1');
    expect(r.state).toBe('live');
    expect(r.startOffset).toBe(2);
  });

  it('块被拆分：原 blockId 消失，引文落到新块 → 跨块 remapped', () => {
    // b1 被拆成 b3（前半，含错题本）+ b4（后半），原 blockId b1 已不存在
    const blocks: BlockText[] = [
      { blockId: 'b3', text: '我的错题本' },
      { blockId: 'b4', text: '一直陪着我走到最后' },
    ];
    const r = remapAnchorAcrossBlocks(base, blocks);
    expect(r.state).toBe('remapped');
    expect(r.blockId).toBe('b3');
    expect(r.startOffset).toBe(2);
    expect(r.endOffset).toBe(5);
  });

  it('引文被移出原块到兄弟块（原块仍在但已换内容）→ 跨块 remapped 到兄弟块', () => {
    const blocks: BlockText[] = [
      { blockId: 'b1', text: '这段已经改写成别的内容了' },
      { blockId: 'b2', text: '后来我才懂得，错题本才是关键' },
    ];
    const r = remapAnchorAcrossBlocks(base, blocks);
    expect(r.state).toBe('remapped');
    expect(r.blockId).toBe('b2');
    expect(blocks[1]?.text.slice(r.startOffset, r.endOffset)).toBe('错题本');
  });

  it('原块没了、多块都含引文：前后文消歧（上下文吻合者胜）', () => {
    // 锚点原块 gone 已消失，错题本同时出现在 bx 与 by；by 的前后文（我的…一直）与锚点吻合
    const gone: Anchor & { blockId: string } = { ...base, blockId: 'gone' };
    const blocks: BlockText[] = [
      { blockId: 'bx', text: '错题本随便提一句' },
      { blockId: 'by', text: '我的错题本一直最重要' },
    ];
    const r = remapAnchorAcrossBlocks(gone, blocks);
    expect(r.state).toBe('remapped');
    expect(r.blockId).toBe('by');
  });

  it('全文都找不到引文 → orphaned，保留原 blockId', () => {
    const blocks: BlockText[] = [{ blockId: 'b9', text: '完全不相关的另一篇内容' }];
    const r = remapAnchorAcrossBlocks(base, blocks);
    expect(r.state).toBe('orphaned');
    expect(r.blockId).toBe('b1');
  });

  it('跨块模糊命中返回 matchedText（供调用方更新 quotedText 以收敛）', () => {
    // 原块没了；新块里引文仅一字之差（更→很），靠模糊匹配找回（长引文，Dice ≥ 阈值）
    const longAnchor: Anchor & { blockId: string } = {
      blockId: 'g1',
      startOffset: 0,
      endOffset: 11,
      quotedText: '复盘远比盲目刷题更重要',
    };
    const blocks: BlockText[] = [{ blockId: 'g2', text: '我一直觉得复盘远比盲目刷题很重要' }];
    const r = remapAnchorAcrossBlocks(longAnchor, blocks);
    expect(r.state).toBe('remapped');
    expect(r.blockId).toBe('g2');
    expect(r.matchedText).toBe('复盘远比盲目刷题很重要');
  });
});
