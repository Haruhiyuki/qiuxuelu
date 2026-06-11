// 队列处理时效（SLA）：超过阈值未处理的工作项标为「超时」，提醒审校者优先处理。
// 阈值默认 48 小时（治理参数，后续可移入 site_settings 配置）。
export const SLA_HOURS = 48;

export function isOverdue(createdAt: Date): boolean {
  return Date.now() - createdAt.getTime() > SLA_HOURS * 3600 * 1000;
}
