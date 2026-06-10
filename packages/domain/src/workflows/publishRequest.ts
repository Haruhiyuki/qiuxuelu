import { WorkflowError } from './error';

// 状态集与 publish_requests.status 的 db check 约束逐字对齐（架构 §5）——改这里必须同步改 db。
// 「提交申请」= 插入一行新请求（初始即 pending），属创建而非状态迁移，故不设 draft 伪状态。
export type PublishRequestStatus =
  | 'pending'
  | 'in_review'
  | 'approved'
  | 'changes_requested'
  | 'rejected'
  | 'withdrawn';

export type PublishRequestAction =
  | 'claim'
  | 'release'
  | 'approve'
  | 'request_changes'
  | 'reject'
  | 'resubmit'
  | 'withdraw';

/**
 * pending → in_review → approved（移 published ref）/ changes_requested / rejected（理由码必填）。
 * release 对应 15 分钟认领租约过期回池；approved/rejected/withdrawn 为终态——再发布走新请求，历史不复用。
 */
export const PUBLISH_REQUEST_TRANSITIONS: Readonly<
  Record<PublishRequestStatus, Partial<Record<PublishRequestAction, PublishRequestStatus>>>
> = {
  pending: { claim: 'in_review', withdraw: 'withdrawn' },
  in_review: {
    approve: 'approved',
    request_changes: 'changes_requested',
    reject: 'rejected',
    release: 'pending',
  },
  changes_requested: { resubmit: 'pending', withdraw: 'withdrawn' },
  approved: {},
  rejected: {},
  withdrawn: {},
};

export function transitionPublishRequest(
  current: PublishRequestStatus,
  action: PublishRequestAction,
): PublishRequestStatus {
  const next = PUBLISH_REQUEST_TRANSITIONS[current][action];
  if (next === undefined) {
    throw new WorkflowError(
      `发布审批：状态「${current}」下不允许执行动作「${action}」`,
      current,
      action,
    );
  }
  return next;
}

/** 动作主体摘要——isReviewer 由调用方先经 can() 判定（doc.publish / queue.claim），此处只管角色关系。 */
export interface PublishRequestActorSummary {
  /** 是否为该发布请求的提交者。 */
  isAuthor: boolean;
  /** 是否具备审批权（角色线）。 */
  isReviewer: boolean;
}

// 审稿人不得审自己的提交（架构 §5，db 约束 + 鉴权双保险——这里是鉴权侧的那一道）。
const PUBLISH_GUARDS: Record<PublishRequestAction, (a: PublishRequestActorSummary) => boolean> = {
  resubmit: (a) => a.isAuthor,
  withdraw: (a) => a.isAuthor,
  claim: (a) => a.isReviewer && !a.isAuthor,
  release: (a) => a.isReviewer,
  approve: (a) => a.isReviewer && !a.isAuthor,
  request_changes: (a) => a.isReviewer && !a.isAuthor,
  reject: (a) => a.isReviewer && !a.isAuthor,
};

export function canActOnPublishRequest(
  action: PublishRequestAction,
  actor: PublishRequestActorSummary,
): boolean {
  return PUBLISH_GUARDS[action](actor);
}
