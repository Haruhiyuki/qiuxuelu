import { describe, expect, it } from 'vitest';
import {
  EDUCATION_STAGES,
  type EducationEntry,
  formatEducation,
  LEGACY_STAGE_MAP,
  sortEducation,
  stageOrder,
} from './education';

describe('stageOrder', () => {
  it('按 EDUCATION_STAGES 的下标给权重', () => {
    expect(stageOrder('初中')).toBe(0);
    expect(stageOrder('本科')).toBe(EDUCATION_STAGES.indexOf('本科'));
    expect(stageOrder('博士')).toBe(EDUCATION_STAGES.indexOf('博士'));
  });

  it('未知阶段排到最后（权重 = 阶段数）', () => {
    expect(stageOrder('幼儿园')).toBe(EDUCATION_STAGES.length);
    expect(stageOrder('')).toBe(EDUCATION_STAGES.length);
  });
});

describe('sortEducation', () => {
  const e = (stage: string, school: string): EducationEntry => ({ stage, school });

  it('按学历阶段升序', () => {
    const sorted = sortEducation([e('博士', 'D'), e('初中', 'A'), e('本科', 'C'), e('高中', 'B')]);
    expect(sorted.map((x) => x.school)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('同阶段保持输入相对次序（稳定排序）', () => {
    const sorted = sortEducation([e('本科', 'first'), e('本科', 'second'), e('本科', 'third')]);
    expect(sorted.map((x) => x.school)).toEqual(['first', 'second', 'third']);
  });

  it('未知阶段沉到末尾', () => {
    const sorted = sortEducation([e('其他', 'X'), e('未知阶段', 'Y'), e('硕士', 'M')]);
    expect(sorted[0]?.school).toBe('M');
    expect(sorted.at(-1)?.school).toBe('Y'); // 未知排在「其他」之后
  });

  it('不修改原数组', () => {
    const input = [e('博士', 'D'), e('初中', 'A')];
    const copy = [...input];
    sortEducation(input);
    expect(input).toEqual(copy);
  });
});

describe('formatEducation', () => {
  it('拼接阶段·学校·方向', () => {
    expect(formatEducation({ stage: '本科', school: '清华大学', field: '计算机' })).toBe(
      '本科 · 清华大学 · 计算机',
    );
  });

  it('省略空白/缺失的方向', () => {
    expect(formatEducation({ stage: '硕士', school: '北大' })).toBe('硕士 · 北大');
    expect(formatEducation({ stage: '硕士', school: '北大', field: '   ' })).toBe('硕士 · 北大');
  });
});

describe('LEGACY_STAGE_MAP', () => {
  it('把旧单字段映射到新阶段', () => {
    expect(LEGACY_STAGE_MAP.大学).toBe('本科');
    expect(LEGACY_STAGE_MAP.毕业).toBe('其他');
    expect(LEGACY_STAGE_MAP.初中).toBe('初中');
  });
});
