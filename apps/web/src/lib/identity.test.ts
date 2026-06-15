import { describe, expect, it } from 'vitest';
import { extractMentionCandidates, isMentionStart, prefixesOf, validateName } from './identity';

describe('validateName', () => {
  it('接受 2–20 位的字母/数字/中文/_/-', () => {
    expect(validateName('张三')).toBeNull();
    expect(validateName('bob')).toBeNull();
    expect(validateName('user_1')).toBeNull();
    expect(validateName('a-b')).toBeNull();
    expect(validateName('张三2024')).toBeNull();
  });

  it('空输入提示填写', () => {
    expect(validateName('')).toBe('请输入名字');
    expect(validateName('   ')).toBe('请输入名字');
  });

  it('拒绝过短/过长', () => {
    expect(validateName('x')).not.toBeNull();
    expect(validateName('一')).not.toBeNull();
    expect(validateName('a'.repeat(21))).not.toBeNull();
    expect(validateName('a'.repeat(20))).toBeNull();
  });

  it('拒绝空格与 @', () => {
    expect(validateName('张 三')).not.toBeNull();
    expect(validateName('a@b')).not.toBeNull();
  });

  it('先 trim 再校验', () => {
    expect(validateName('  bob  ')).toBeNull();
  });
});

describe('isMentionStart', () => {
  it('开头即提及', () => {
    expect(isMentionStart('@bob', 0)).toBe(true);
  });

  it('前缀为邮箱本地段字符则不是提及', () => {
    expect(isMentionStart('foo@bar', 3)).toBe(false); // 'o' 在 @ 前
    expect(isMentionStart('a.b@c', 3)).toBe(false);
  });

  it('CJK / 空格 / 标点前缀视为提及', () => {
    expect(isMentionStart('看法@张三', '看法'.length)).toBe(true);
    expect(isMentionStart('hi @bob', 3)).toBe(true);
  });
});

describe('extractMentionCandidates', () => {
  it('提取多个候选并去重', () => {
    expect(extractMentionCandidates('@bob 你好 @alice 再 @bob')).toEqual(['bob', 'alice']);
  });

  it('跳过邮箱中的 @', () => {
    expect(extractMentionCandidates('联系 me@example.com')).toEqual([]);
  });

  it('CJK 候选取 @ 后最长合法连串', () => {
    expect(extractMentionCandidates('见@张三的看法')).toEqual(['张三的看法']);
  });

  it('无提及返回空数组', () => {
    expect(extractMentionCandidates('一段没有提及的文字')).toEqual([]);
  });
});

describe('prefixesOf', () => {
  it('从全长降到 2 字符', () => {
    expect(prefixesOf('张三的')).toEqual(['张三的', '张三']);
    expect(prefixesOf('张三')).toEqual(['张三']);
  });

  it('单字符无 ≥2 前缀', () => {
    expect(prefixesOf('张')).toEqual([]);
  });

  it('按码点而非 UTF-16 切分', () => {
    // emoji 占两个 UTF-16 码元，应按 1 个字符计
    expect(prefixesOf('😀ab')).toEqual(['😀ab', '😀a']);
  });
});
