/** sections.stage 的展示文案（取值集合由 DB check 约束保证） */
const STAGE_LABELS: Record<string, string> = {
  junior: '初中',
  senior: '高中',
  college: '大学',
  general: '通用',
};

export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}
