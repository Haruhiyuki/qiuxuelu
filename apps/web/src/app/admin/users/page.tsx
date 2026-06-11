import { getDb, roleGrants, sanctions, sections, user as userTable, userTrust } from '@harublog/db';
import { Badge } from '@harublog/ui';
import { desc, eq, isNull } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  type RoleView,
  type SanctionView,
  UserAdminPanel,
} from '@/components/admin/user-admin-panel';
import { ROLE_LABELS, type StaffRole } from '@/lib/roles';
import { getSession } from '@/lib/session';
import { loadActor } from '@/server/actors';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '用户管理', robots: { index: false } };

function Forbidden() {
  return (
    <div className="mx-auto w-full max-w-xl px-6 py-20 text-center">
      <h1 className="font-serif text-2xl text-ink-900">无权访问</h1>
      <p className="mt-3 text-ink-500 text-sm">用户管理需要管理员角色。</p>
      <p className="mt-6 text-sm">
        <Link href="/" className="text-brand-700 hover:text-brand-900">
          ← 返回首页
        </Link>
      </p>
    </div>
  );
}

export default async function UsersAdminPage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  const actor = await loadActor(session.user.id);
  if (actor === null) {
    return <Forbidden />;
  }
  // 进入门槛：能任命角色或制裁或调信任之一（具体控件按能力显隐，动作端再强制）
  const canGrantSection = actor.roles.some((r) => r.role === 'admin' || r.role === 'superadmin');
  const canGrantGlobal = actor.roles.some((r) => r.role === 'superadmin');
  const canSanction = canGrantSection; // user.suspend = admin+
  const canAdjustTrust = canGrantSection; // user.trust_adjust = admin+
  if (!canGrantSection && !canGrantGlobal) {
    return <Forbidden />;
  }

  const db = getDb();
  const users = await db
    .select({
      id: userTable.id,
      name: userTable.name,
      email: userTable.email,
      status: userTable.status,
      level: userTrust.level,
      locked: userTrust.locked,
    })
    .from(userTable)
    .leftJoin(userTrust, eq(userTrust.userId, userTable.id))
    .orderBy(desc(userTable.createdAt))
    .limit(50);

  const grantRows = await db
    .select({
      id: roleGrants.id,
      userId: roleGrants.userId,
      role: roleGrants.role,
      sectionName: sections.name,
    })
    .from(roleGrants)
    .leftJoin(sections, eq(sections.id, roleGrants.sectionId))
    .where(isNull(roleGrants.revokedAt));
  const rolesByUser = new Map<string, RoleView[]>();
  for (const g of grantRows) {
    const list = rolesByUser.get(g.userId) ?? [];
    list.push({ id: g.id, role: g.role, sectionName: g.sectionName });
    rolesByUser.set(g.userId, list);
  }

  const now = new Date();
  const sanctionRows = await db
    .select({
      id: sanctions.id,
      userId: sanctions.userId,
      kind: sanctions.kind,
      endsAt: sanctions.endsAt,
    })
    .from(sanctions)
    .where(isNull(sanctions.revokedAt));
  const sanctionsByUser = new Map<string, SanctionView[]>();
  for (const s of sanctionRows) {
    if (s.endsAt !== null && s.endsAt <= now) {
      continue; // 已过期
    }
    const list = sanctionsByUser.get(s.userId) ?? [];
    list.push({ id: s.id, kind: s.kind });
    sanctionsByUser.set(s.userId, list);
  }

  const sectionOpts = await db
    .select({ id: sections.id, name: sections.name })
    .from(sections)
    .orderBy(sections.position);

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <header className="border-ink-200 border-b pb-6">
        <p className="text-ink-500 text-sm">
          <Link href="/admin" className="hover:text-brand-700">
            ← 管理后台
          </Link>
        </p>
        <h1 className="mt-2 font-semibold font-serif text-2xl text-ink-900">用户管理</h1>
        <p className="mt-2 text-ink-500 text-sm">最近 50 名用户 · 角色任命、制裁、信任等级</p>
      </header>

      <ul className="mt-4 flex flex-col gap-4">
        {users.map((u) => (
          <li key={u.id} className="rounded-sm border border-ink-200 bg-paper-50 p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-ink-900">{u.name}</span>
              <span className="text-ink-400">{u.email}</span>
              <Badge variant="outline">TL{u.level ?? 0}</Badge>
              {u.locked ? <Badge variant="accent">锁定</Badge> : null}
              {u.status === 'suspended' ? <Badge variant="accent">已停用</Badge> : null}
              {(rolesByUser.get(u.id) ?? []).map((r) => (
                <Badge key={r.id} variant="brand">
                  {ROLE_LABELS[r.role as StaffRole] ?? r.role}
                  {r.sectionName ? `·${r.sectionName}` : ''}
                </Badge>
              ))}
            </div>
            <UserAdminPanel
              userId={u.id}
              level={u.level ?? 0}
              locked={u.locked ?? false}
              roles={rolesByUser.get(u.id) ?? []}
              sanctions={sanctionsByUser.get(u.id) ?? []}
              sections={sectionOpts}
              canGrantSection={canGrantSection}
              canGrantGlobal={canGrantGlobal}
              canSanction={canSanction}
              canAdjustTrust={canAdjustTrust}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
