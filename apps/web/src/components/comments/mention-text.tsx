// 把评论正文里的 @用户名 渲染成指向用户主页的链接（其余原样输出，保留换行/空白）。
// 纯渲染、无状态：服务端/客户端组件皆可用。链接走 /u/by/<username> 解析重定向，无需在此解析 id。
import Link from 'next/link';
import type { ReactNode } from 'react';

const MENTION_RE = /@([a-zA-Z0-9_]{3,20})/g;

export function MentionText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(MENTION_RE)) {
    const at = m.index;
    // @ 前必须是行首或空白，否则不是提及（如邮箱 a@b）
    if (at > 0 && !/\s/.test(text[at - 1] as string)) {
      continue;
    }
    if (at > last) {
      out.push(text.slice(last, at));
    }
    const username = m[1] as string;
    out.push(
      <Link
        key={`m-${key}`}
        href={`/u/by/${username}`}
        className="text-brand-700 hover:text-brand-900"
      >
        @{username}
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
