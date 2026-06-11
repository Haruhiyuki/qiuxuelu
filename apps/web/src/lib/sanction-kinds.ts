// 制裁种类（与 db sanctions.kind / domain SanctionKind 逐字一致）。
export const SANCTION_KINDS = ['silence', 'no_suggest', 'no_edit', 'suspend'] as const;
export type SanctionKindCode = (typeof SANCTION_KINDS)[number];

export const SANCTION_KIND_LABELS: Record<SanctionKindCode, string> = {
  silence: '禁言（不能评论/行内评论）',
  no_suggest: '禁建议（不能提编辑建议）',
  no_edit: '禁编辑（不能创建/提交/直编）',
  suspend: '封禁（除阅读外全部禁止）',
};
