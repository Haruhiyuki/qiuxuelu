// 按用户名解析到主页：@提及链接（/u/by/<username>）在此查 id 后重定向到 /u/<id>，查不到则 404。
import { getDb, user as userTable } from '@harublog/db';
import { eq } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function ByUsernamePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const rows = await getDb()
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.username, decodeURIComponent(username)))
    .limit(1);
  if (rows[0] === undefined) {
    notFound();
  }
  redirect(`/u/${rows[0].id}`);
}
