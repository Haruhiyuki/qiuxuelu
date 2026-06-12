// better-auth 错误码 → 中文文案。未收录的码统一兜底，避免把英文原文漏给用户。
const MESSAGES: Record<string, string> = {
  USER_ALREADY_EXISTS: '该邮箱已注册，请直接登录',
  INVALID_EMAIL_OR_PASSWORD: '邮箱或密码不正确',
  INVALID_EMAIL: '邮箱格式不正确',
  INVALID_PASSWORD: '密码不正确',
  PASSWORD_TOO_SHORT: '密码至少需要 8 个字符',
  PASSWORD_TOO_LONG: '密码长度超出上限',
  USER_NOT_FOUND: '账号不存在',
  FAILED_TO_CREATE_USER: '注册失败，请稍后重试',
  FAILED_TO_CREATE_SESSION: '登录状态创建失败，请稍后重试',
  EMAIL_NOT_VERIFIED: '邮箱尚未验证：验证邮件已重新发送，请到邮箱点击链接完成验证后再登录',
};

export function translateAuthError(code: string | undefined, message?: string): string {
  if (code !== undefined && code in MESSAGES) {
    return MESSAGES[code] as string;
  }
  // 自定义 databaseHooks 抛出的中文文案（无错误码）直接透传；英文原文不外漏
  if (message !== undefined && /[一-鿿]/.test(message)) {
    return message;
  }
  return '操作失败，请稍后重试';
}
