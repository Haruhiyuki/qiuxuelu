// 按名字解析到主页：@提及链接（/u/by/<候选串>）按最长前缀匹配现役名与改名历史，
// 命中后重定向到 /u/<id>（隐藏稳定标识符）——改名后旧 @ 仍可达。查不到则 404。
import { getDb } from '@harublog/db';
import { notFound, redirect } from 'next/navigation';
import { resolveMentionCandidate } from '@/server/identity';

export const dynamic = 'force-dynamic';

export default async function ByNamePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const hit = await resolveMentionCandidate(getDb(), decodeURIComponent(username));
  if (hit === null) {
    notFound();
  }
  redirect(`/u/${hit.userId}`);
}
