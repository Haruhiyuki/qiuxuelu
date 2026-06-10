import { WorkflowError } from './error';

// 状态集严格对齐 suggestions.status 的 db check 约束（架构 §5 / ADR-0004）——改这里必须同步改 db。
export type SuggestionStatus =
  | 'open'
  | 'under_review'
  | 'merged'
  | 'changes_requested'
  | 'rejected'
  | 'outdated'
  | 'withdrawn';

export type SuggestionAction =
  | 'claim'
  | 'release'
  | 'merge'
  | 'request_changes'
  | 'reject'
  | 'mark_outdated'
  | 'revise'
  | 'rebase'
  | 'withdraw';

/**
 * open → under_review → merged / changes_requested（分支追加修订后 revise 回 open）/ rejected（理由码必填）
 * / outdated（主线前移冲突，rebase 走三栏变基 UI 后回 open）/ withdrawn。
 * mark_outdated 在任何活跃态都可触发——冲突检测发生在主线 ref 移动时，与建议自身所处环节无关。
 */
export const SUGGESTION_TRANSITIONS: Readonly<
  Record<SuggestionStatus, Partial<Record<SuggestionAction, SuggestionStatus>>>
> = {
  open: { claim: 'under_review', mark_outdated: 'outdated', withdraw: 'withdrawn' },
  under_review: {
    merge: 'merged',
    request_changes: 'changes_requested',
    reject: 'rejected',
    release: 'open',
    mark_outdated: 'outdated',
    withdraw: 'withdrawn',
  },
  changes_requested: { revise: 'open', mark_outdated: 'outdated', withdraw: 'withdrawn' },
  outdated: { rebase: 'open', withdraw: 'withdrawn' },
  merged: {},
  rejected: {},
  withdrawn: {},
};

export function transitionSuggestion(
  current: SuggestionStatus,
  action: SuggestionAction,
): SuggestionStatus {
  const next = SUGGESTION_TRANSITIONS[current][action];
  if (next === undefined) {
    throw new WorkflowError(
      `建议审校：状态「${current}」下不允许执行动作「${action}」`,
      current,
      action,
    );
  }
  return next;
}

/**
 * 动作主体摘要。isReviewer 由调用方先经 can() 判定——角色线、文档作者（TL2+ 审自己文章的建议，
 * 架构 §5）或 TL4 信任线都折叠进这一个标志；isAuthor 指建议作者本人。
 */
export interface SuggestionActorSummary {
  isAuthor: boolean;
  isReviewer: boolean;
  /** 系统自动动作（主线前移触发 mark_outdated、作者失联 14 天转队列等）。 */
  isSystem?: boolean;
}

// 审校者不得裁决自己提交的建议；分支演进（revise/rebase/withdraw）仅建议作者本人。
const SUGGESTION_GUARDS: Record<SuggestionAction, (a: SuggestionActorSummary) => boolean> = {
  claim: (a) => a.isReviewer && !a.isAuthor,
  release: (a) => a.isReviewer,
  merge: (a) => a.isReviewer && !a.isAuthor,
  request_changes: (a) => a.isReviewer && !a.isAuthor,
  reject: (a) => a.isReviewer && !a.isAuthor,
  mark_outdated: (a) => a.isSystem === true || a.isReviewer,
  revise: (a) => a.isAuthor,
  rebase: (a) => a.isAuthor,
  withdraw: (a) => a.isAuthor,
};

export function canActOnSuggestion(
  action: SuggestionAction,
  actor: SuggestionActorSummary,
): boolean {
  return SUGGESTION_GUARDS[action](actor);
}
