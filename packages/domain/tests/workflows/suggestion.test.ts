import { describe, expect, it } from 'vitest';
import { WorkflowError } from '../../src/workflows/error';
import {
  canActOnSuggestion,
  type SuggestionAction,
  type SuggestionStatus,
  transitionSuggestion,
} from '../../src/workflows/suggestion';

describe('建议审校状态机 —— 合法迁移', () => {
  it('主路径：open → under_review → merged', () => {
    expect(transitionSuggestion('open', 'claim')).toBe('under_review');
    expect(transitionSuggestion('under_review', 'merge')).toBe('merged');
  });

  it('往返路径：request_changes 后作者 revise 回 open（迭代史保留，ADR-0004）', () => {
    expect(transitionSuggestion('under_review', 'request_changes')).toBe('changes_requested');
    expect(transitionSuggestion('changes_requested', 'revise')).toBe('open');
  });

  it('冲突路径：主线前移 mark_outdated，三栏变基后 rebase 回 open', () => {
    expect(transitionSuggestion('open', 'mark_outdated')).toBe('outdated');
    expect(transitionSuggestion('under_review', 'mark_outdated')).toBe('outdated');
    expect(transitionSuggestion('changes_requested', 'mark_outdated')).toBe('outdated');
    expect(transitionSuggestion('outdated', 'rebase')).toBe('open');
  });

  it('裁决与撤回：reject / withdraw / release', () => {
    expect(transitionSuggestion('under_review', 'reject')).toBe('rejected');
    expect(transitionSuggestion('under_review', 'release')).toBe('open');
    expect(transitionSuggestion('open', 'withdraw')).toBe('withdrawn');
    expect(transitionSuggestion('outdated', 'withdraw')).toBe('withdrawn');
  });
});

describe('建议审校状态机 —— 非法迁移', () => {
  const illegal: [SuggestionStatus, SuggestionAction][] = [
    ['open', 'merge'],
    ['open', 'reject'],
    ['merged', 'withdraw'],
    ['merged', 'claim'],
    ['rejected', 'revise'],
    ['withdrawn', 'claim'],
    ['changes_requested', 'merge'],
    ['outdated', 'merge'],
  ];
  for (const [status, action] of illegal) {
    it(`${status} 状态下 ${action} 抛 WorkflowError`, () => {
      expect(() => transitionSuggestion(status, action)).toThrow(WorkflowError);
      expect(() => transitionSuggestion(status, action)).toThrow(/不允许执行动作/);
    });
  }

  it('WorkflowError 携带 current 与 action 供上层映射 409', () => {
    try {
      transitionSuggestion('merged', 'withdraw');
      expect.unreachable('应当抛错');
    } catch (e) {
      expect(e).toBeInstanceOf(WorkflowError);
      const err = e as WorkflowError;
      expect(err.current).toBe('merged');
      expect(err.action).toBe('withdraw');
    }
  });
});

describe('建议审校 guards', () => {
  it('merge/reject 需审校权且不得裁决自己的建议', () => {
    expect(canActOnSuggestion('merge', { isAuthor: false, isReviewer: true })).toBe(true);
    expect(canActOnSuggestion('merge', { isAuthor: true, isReviewer: true })).toBe(false);
    expect(canActOnSuggestion('reject', { isAuthor: false, isReviewer: false })).toBe(false);
  });

  it('withdraw/revise/rebase 仅建议作者', () => {
    expect(canActOnSuggestion('withdraw', { isAuthor: true, isReviewer: false })).toBe(true);
    expect(canActOnSuggestion('withdraw', { isAuthor: false, isReviewer: true })).toBe(false);
    expect(canActOnSuggestion('revise', { isAuthor: false, isReviewer: true })).toBe(false);
    expect(canActOnSuggestion('rebase', { isAuthor: true, isReviewer: false })).toBe(true);
  });

  it('mark_outdated 允许系统或审校者触发', () => {
    expect(
      canActOnSuggestion('mark_outdated', { isAuthor: false, isReviewer: false, isSystem: true }),
    ).toBe(true);
    expect(canActOnSuggestion('mark_outdated', { isAuthor: false, isReviewer: true })).toBe(true);
    expect(canActOnSuggestion('mark_outdated', { isAuthor: true, isReviewer: false })).toBe(false);
  });
});
