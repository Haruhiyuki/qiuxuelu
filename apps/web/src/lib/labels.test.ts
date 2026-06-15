import { describe, expect, it } from 'vitest';
import { docStatusLabel, revisionKindLabel } from './doc-labels';
import { isOverdue, SLA_HOURS } from './sla';
import { stageLabel } from './stage';

describe('doc-labels', () => {
  it('已知状态/类型给中文', () => {
    expect(docStatusLabel('draft')).toBe('草稿');
    expect(docStatusLabel('published')).toBe('已发布');
    expect(revisionKindLabel('edit')).toBe('编辑');
    expect(revisionKindLabel('rollback')).toBe('回退');
  });

  it('未知取值原样透传（不抛错）', () => {
    expect(docStatusLabel('weird')).toBe('weird');
    expect(revisionKindLabel('weird')).toBe('weird');
  });
});

describe('stageLabel', () => {
  it('映射板块阶段', () => {
    expect(stageLabel('junior')).toBe('初中');
    expect(stageLabel('general')).toBe('通用');
  });
  it('未知透传', () => {
    expect(stageLabel('x')).toBe('x');
  });
});

describe('isOverdue', () => {
  it('超过 SLA 阈值判为超时', () => {
    const old = new Date(Date.now() - (SLA_HOURS + 1) * 3600 * 1000);
    expect(isOverdue(old)).toBe(true);
  });
  it('阈值内不超时', () => {
    const recent = new Date(Date.now() - 1 * 3600 * 1000);
    expect(isOverdue(recent)).toBe(false);
  });
});
