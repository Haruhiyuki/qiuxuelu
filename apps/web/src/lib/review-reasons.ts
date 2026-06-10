/** 驳回理由码（架构 §5：拒稿必填结构化理由码，喂翻案率统计）；client/server 共用同一组字面量。 */
export const REJECT_REASON_CODES = [
  'quality_low',
  'off_topic',
  'duplicate',
  'incomplete',
  'compliance',
  'other',
] as const;

export type RejectReasonCode = (typeof REJECT_REASON_CODES)[number];

export const REJECT_REASON_LABELS: Record<RejectReasonCode, string> = {
  quality_low: '质量未达发布标准',
  off_topic: '内容与板块主题不符',
  duplicate: '与已有文章重复',
  incomplete: '内容不完整或尚未成文',
  compliance: '涉及合规风险内容',
  other: '其他原因（见备注）',
};
