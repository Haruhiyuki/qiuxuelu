/** 非法状态迁移用专用错误类型，便于 Server Action 层映射为 409 而非 500。 */
export class WorkflowError extends Error {
  readonly current: string;
  readonly action: string;

  constructor(message: string, current: string, action: string) {
    super(message);
    this.name = 'WorkflowError';
    this.current = current;
    this.action = action;
  }
}
