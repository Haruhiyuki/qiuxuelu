// 把评论正文里的 @名字 渲染成指向用户主页的链接（其余原样输出，保留换行/空白）。
// 纯渲染、无状态：服务端/客户端组件皆可用。统一身份：name 即句柄，允许中文。
// CJK 无词界，链接的候选串可能长于真实名字——/u/by/<候选> 路由按最长前缀解析后重定向，
// 自动补全插入的提及自带尾随空格，主路径精确。
import Link from 'next/link';
import type { ReactNode } from 'react';
import { isMentionStart, MENTION_SCAN_RE } from '@/lib/identity';

export function MentionText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(MENTION_SCAN_RE)) {
    const at = m.index;
    // 邮箱守卫：@ 前是 ASCII 邮箱本地段字符则不视为提及（CJK 前缀不受影响）
    if (!isMentionStart(text, at)) {
      continue;
    }
    if (at > last) {
      out.push(text.slice(last, at));
    }
    const candidate = m[1] as string;
    out.push(
      <Link
        key={`m-${key}`}
        href={`/u/by/${encodeURIComponent(candidate)}`}
        className="text-brand-700 hover:text-brand-900"
      >
        @{candidate}
      </Link>,
    );
    key += 1;
    last = at + m[0].length;
  }
  if (last < text.length) {
    out.push(text.slice(last));
  }
  return <>{out}</>;
}
