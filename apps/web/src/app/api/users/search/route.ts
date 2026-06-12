// @提及自动补全：按名字前缀/片段返回候选（统一身份：name 即句柄）。仅登录用户可用。
import { getDb, user as userTable } from '@harublog/db';
import { and, eq, ilike, ne, or } from 'drizzle-orm';
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
      name: userTable.name,
      image: userTable.image,
    })
    .from(userTable)
    .where(
      and(
        // 注销账号不进候选
        eq(userTable.status, 'active'),
        ne(userTable.id, session.user.id),
        or(ilike(userTable.name, `${like}%`), ilike(userTable.name, `%${like}%`)),
      ),
    )
    .limit(6);
  return Response.json({ users: rows });
}
