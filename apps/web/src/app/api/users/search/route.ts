// @提及自动补全：按用户名前缀 / 昵称片段返回可被提及的用户（须已设用户名）。仅登录用户可用。
import { getDb, user as userTable } from '@harublog/db';
import { and, ilike, isNotNull, or } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

// ilike 通配符转义：用户输入里的 % _ \ 不能当通配符
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function GET(req: NextRequest): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ users: [] }, { status: 401 });
  }
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (q.length === 0) {
    return Response.json({ users: [] });
  }
  const like = escapeLike(q);
  const rows = await getDb()
    .select({
      username: userTable.username,
      name: userTable.name,
      image: userTable.image,
    })
    .from(userTable)
    .where(
      and(
        isNotNull(userTable.username),
        or(ilike(userTable.username, `${like}%`), ilike(userTable.name, `%${like}%`)),
      ),
    )
    .limit(6);
  return Response.json({ users: rows });
}
