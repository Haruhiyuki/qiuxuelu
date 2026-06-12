// 统一身份规则（纯函数，客户端/服务端共用）：
// name 既是署名也是 @提及句柄——2–20 位任意文字的字母/数字/_/-（允许中文），
// 无空白无 @，全站唯一（小写比较）。改动此规则需同步 signup hook 与 renameUser。

/** 名字合法字符集与长度（\p{L} 覆盖 CJK；不含空白，保证 @提及可被词法切分） */
export const NAME_RE = /^[\p{L}\p{N}_-]{2,20}$/u;

/** 校验名字格式；通过返回 null，否则返回中文错误信息。 */
export function validateName(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0) {
    return '请输入名字';
  }
  if (!NAME_RE.test(name)) {
    return '名字为 2–20 个字符，可用中文、字母、数字、_ 或 -，不能含空格';
  }
  return null;
}

/**
 * 正文中的 @提及候选串：@ 后最长的合法字符连串（≤20）。
 * CJK 无词界，候选可能比真实名字长（如「@张三的看法」），由服务端按最长前缀匹配消歧；
 * 自动补全插入时自带尾随空格，主路径无歧义。
 */
export const MENTION_SCAN_RE = /@([\p{L}\p{N}_-]{2,20})/gu;

/** @ 前一字符若是 ASCII 邮箱本地段字符则视为邮箱片段而非提及（CJK 前缀不受影响）。 */
const EMAIL_LOCAL_CHAR = /[A-Za-z0-9._%+-]/;

export function isMentionStart(text: string, atIndex: number): boolean {
  return atIndex === 0 || !EMAIL_LOCAL_CHAR.test(text.charAt(atIndex - 1));
}

/** 提取正文中的去重提及候选串（已应用邮箱守卫）。 */
export function extractMentionCandidates(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(MENTION_SCAN_RE)) {
    if (m.index !== undefined && isMentionStart(text, m.index)) {
      out.add(m[1] as string);
    }
  }
  return [...out];
}

/** 候选串的全部前缀（从全长降到 2 字符），供最长前缀匹配。 */
export function prefixesOf(candidate: string): string[] {
  const chars = [...candidate];
  const out: string[] = [];
  for (let len = Math.min(chars.length, 20); len >= 2; len--) {
    out.push(chars.slice(0, len).join(''));
  }
  return out;
}
