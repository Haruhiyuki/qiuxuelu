// 举报结构化理由码（与制裁理由分开）。
export const FLAG_REASON_CODES = [
  'spam',
  'abuse',
  'offtopic',
  'illegal',
  'misinfo',
  'other',
] as const;
export type FlagReasonCode = (typeof FLAG_REASON_CODES)[number];

export const FLAG_REASON_LABELS: Record<FlagReasonCode, string> = {
  spam: '垃圾广告',
  abuse: '辱骂或人身攻击',
  offtopic: '与主题无关',
  illegal: '违法或侵权',
  misinfo: '虚假/误导信息',
  other: '其他（请说明）',
};
