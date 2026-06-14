// 教育经历（个人资料，自愿公开）：可增减的多条记录，每条 = 学历阶段 + 学校 + 选填专业/方向。
// 保存时按学历阶段排序（client 表单与 server 动作共用本模块；纯函数、无 IO）。

/** 学历阶段（有序，下标即排序权重；'其他' 及未知阶段排最后）。 */
export const EDUCATION_STAGES = [
  '初中',
  '高中',
  '中专/职高',
  '专科',
  '本科',
  '硕士',
  '博士',
  '其他',
] as const;
export type EducationStage = (typeof EDUCATION_STAGES)[number];

export interface EducationEntry {
  /** 学历阶段 */
  stage: string;
  /** 学校 */
  school: string;
  /** 专业 / 方向（选填） */
  field?: string;
}

const STAGE_ORDER = new Map<string, number>(EDUCATION_STAGES.map((s, i) => [s, i]));

/** 学历阶段排序权重；未知阶段排到最后。 */
export function stageOrder(stage: string): number {
  return STAGE_ORDER.get(stage) ?? EDUCATION_STAGES.length;
}

/** 按学历阶段升序稳定排序（同阶段保留输入相对次序）。 */
export function sortEducation<T extends EducationEntry>(list: T[]): T[] {
  return list
    .map((e, i) => [e, i] as const)
    .sort((a, b) => stageOrder(a[0].stage) - stageOrder(b[0].stage) || a[1] - b[1])
    .map(([e]) => e);
}

/** 旧单字段 educationStage（初中/高中/大学/毕业/其他）→ 新阶段，迁移老资料给编辑起点。 */
export const LEGACY_STAGE_MAP: Record<string, string> = {
  初中: '初中',
  高中: '高中',
  大学: '本科',
  毕业: '其他',
  其他: '其他',
};

/** 单条经历展示串：本科 · 清华大学 · 计算机。 */
export function formatEducation(e: EducationEntry): string {
  return [e.stage, e.school, e.field]
    .filter((s) => s !== undefined && s.trim().length > 0)
    .join(' · ');
}
