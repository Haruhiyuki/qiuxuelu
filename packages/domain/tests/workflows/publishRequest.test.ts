import { describe, expect, it } from 'vitest';
import { WorkflowError } from '../../src/workflows/error';
import {
  canActOnPublishRequest,
  type PublishRequestAction,
  type PublishRequestStatus,
  transitionPublishRequest,
} from '../../src/workflows/publishRequest';

describe('发布审批状态机 —— 合法迁移', () => {
  it('主路径：pending → in_review → approved（创建请求即 pending，不经状态机）', () => {
    expect(transitionPublishRequest('pending', 'claim')).toBe('in_review');
    expect(transitionPublishRequest('in_review', 'approve')).toBe('approved');
  });

  it('退回路径：in_review → changes_requested → resubmit 回 pending', () => {
    expect(transitionPublishRequest('in_review', 'request_changes')).toBe('changes_requested');
    expect(transitionPublishRequest('changes_requested', 'resubmit')).toBe('pending');
  });

  it('拒稿与撤回：in_review → rejected；pending/changes_requested → withdrawn 终态', () => {
    expect(transitionPublishRequest('in_review', 'reject')).toBe('rejected');
    expect(transitionPublishRequest('pending', 'withdraw')).toBe('withdrawn');
    expect(transitionPublishRequest('changes_requested', 'withdraw')).toBe('withdrawn');
  });

  it('租约过期回池：in_review → release 回 pending', () => {
    expect(transitionPublishRequest('in_review', 'release')).toBe('pending');
  });
});

describe('发布审批状态机 —— 非法迁移', () => {
  const illegal: [PublishRequestStatus, PublishRequestAction][] = [
    ['pending', 'approve'],
    ['pending', 'release'],
    ['approved', 'withdraw'],
    ['approved', 'claim'],
    ['rejected', 'resubmit'],
    ['withdrawn', 'resubmit'],
    ['withdrawn', 'claim'],
  ];
  for (const [status, action] of illegal) {
    it(`${status} 状态下 ${action} 抛 WorkflowError（中文消息）`, () => {
      expect(() => transitionPublishRequest(status, action)).toThrow(WorkflowError);
      expect(() => transitionPublishRequest(status, action)).toThrow(/不允许执行动作/);
    });
  }
});

describe('发布审批 guards', () => {
  it('withdraw/resubmit 仅作者', () => {
    expect(canActOnPublishRequest('resubmit', { isAuthor: true, isReviewer: false })).toBe(true);
    expect(canActOnPublishRequest('resubmit', { isAuthor: false, isReviewer: true })).toBe(false);
    expect(canActOnPublishRequest('withdraw', { isAuthor: false, isReviewer: true })).toBe(false);
  });

  it('approve 需角色线且不得审自己的提交', () => {
    expect(canActOnPublishRequest('approve', { isAuthor: false, isReviewer: true })).toBe(true);
    expect(canActOnPublishRequest('approve', { isAuthor: true, isReviewer: true })).toBe(false);
    expect(canActOnPublishRequest('approve', { isAuthor: false, isReviewer: false })).toBe(false);
  });

  it('claim 同样排除本人提交', () => {
    expect(canActOnPublishRequest('claim', { isAuthor: true, isReviewer: true })).toBe(false);
    expect(canActOnPublishRequest('claim', { isAuthor: false, isReviewer: true })).toBe(true);
  });
});
