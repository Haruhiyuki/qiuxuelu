/**
 * 信任事件种类——trust_events 表的 kind 枚举来源。
 * 等级由事件流重放聚合为 TrustStats 后经 computeLevel 结算（可重放重算，架构 §4）；
 * delta 是辅助性的信任分增量，用于看板与异常晋升曲线监控，不直接决定等级。
 */
export type TrustEventKind =
  | 'comment_approved'
  | 'comment_removed'
  | 'suggestion_submitted'
  | 'suggestion_merged'
  | 'suggestion_rejected'
  | 'flag_upheld'
  | 'flag_dismissed'
  | 'doc_published'
  | 'patrol_reverted'
  | 'sanction_issued'
  | 'manual_adjust';

/**
 * 各事件的信任分 delta 常量表。
 * 量级原则：合入一次建议 ≈ 十条普通评论（「建议被采纳率」是晋升核心指标）；
 * 负向事件惩罚重于对称值以抬高刷分成本（风险登记簿「信任体系刷分提权」对策）。
 */
export const TRUST_EVENT_DELTAS: Record<TrustEventKind, number> = {
  comment_approved: 1,
  comment_removed: -3,
  suggestion_submitted: 0,
  suggestion_merged: 10,
  suggestion_rejected: -2,
  flag_upheld: 2,
  flag_dismissed: -1,
  doc_published: 5,
  patrol_reverted: -5,
  sanction_issued: -20,
  // 人工调整的 delta 由事件载荷携带，常量表恒为 0
  manual_adjust: 0,
};
