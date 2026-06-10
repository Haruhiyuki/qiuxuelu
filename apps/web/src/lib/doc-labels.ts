/** documents.status / revisions.kind 的中文展示文案（取值集合由 DB check 约束保证）。 */
const DOC_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  pending: '待审',
  published: '已发布',
  archived: '已归档',
};

const REVISION_KIND_LABELS: Record<string, string> = {
  edit: '编辑',
  merge_suggestion: '合并建议',
  rollback: '回滚',
  collab_checkpoint: '协作快照',
  import: '导入',
};

export function docStatusLabel(status: string): string {
  return DOC_STATUS_LABELS[status] ?? status;
}

export function revisionKindLabel(kind: string): string {
  return REVISION_KIND_LABELS[kind] ?? kind;
}
