import {
  documents,
  getDb,
  roleGrants,
  sanctions,
  sections,
  user as userTable,
  userTrust,
} from '@harublog/db';
import { Badge, cn } from '@harublog/ui';
import { and, count, countDistinct, desc, eq, gt, ilike, inArray, isNull, or } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AdminForbidden } from '@/components/admin/admin-forbidden';
import { AdminPageHeader } from '@/components/admin/admin-page-header';
import {
  type RoleView,
  type SanctionView,
  UserAdminPanel,
} from '@/components/admin/user-admin-panel';
import { Pagination } from '@/components/pagination';
import { formatDate } from '@/lib/format';
import { ROLE_LABELS, type StaffRole } from '@/lib/roles';
import { getSession } from '@/lib/session';
import { loadActor } from '@/server/actors';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '用户管理', robots: { index: false } };

const PAGE_SIZE = 40;

// 受制裁种类的短标签（列表行内速览；完整管理在 UserAdminPanel）
const SANCTION_SHORT: Record<string, string> = {
  suspend: '封禁',
  silence: '禁言',
  no_suggest: '禁建议',
  no_edit: '禁编辑',
};

type FilterKey = '' | 'staff' | 'sanctioned' | 'suspended' | 'locked';
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: '', label: '全部' },
  { key: 'staff', label: '管理人员' },
  { key: 'sanctioned', label: '受制裁' },
  { key: 'suspended', label: '已停用' },
  { key: 'locked', label: '已锁定' },
];

export default async function UsersAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; filter?: string }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const q = (sp.q ?? '').trim();
  const filter: FilterKey = (
    FILTERS.some((f) => f.key === sp.filter) ? sp.filter : ''
  ) as FilterKey;

  const actor = await loadActor(session.user.id);
  if (actor === null) {
    return <AdminForbidden reason="用户管理需要管理员角色。" />;
  }
  const canGrantSection = actor.roles.some((r) => r.role === 'admin' || r.role === 'superadmin');
  const canGrantGlobal = actor.roles.some((r) => r.role === 'superadmin');
  const canSanction = canGrantSection; // user.suspend = admin+
  const canAdjustTrust = canGrantSection; // user.trust_adjust = admin+
  if (!canGrantSection && !canGrantGlobal) {
    return <AdminForbidden reason="用户管理需要管理员角色。" />;
  }

  const db = getDb();
  const now = new Date();
  const scalar = async (p: Promise<{ n: number }[]>) => Number((await p)[0]?.n ?? 0);

  // 活跃制裁子查询（未撤销且未到期）——筛选与计数共用语义
  const activeSanctionWhere = and(
    isNull(sanctions.revokedAt),
    or(isNull(sanctions.endsAt), gt(sanctions.endsAt, now)),
  );

  // 各分组计数（全局，忽略搜索词）——用于筛选标签上的数字
  const [totalCount, staffCount, sanctionedCount, suspendedCount, lockedCount] = await Promise.all([
    scalar(db.select({ n: count() }).from(userTable)),
    scalar(
      db
        .select({ n: countDistinct(roleGrants.userId) })
        .from(roleGrants)
        .where(isNull(roleGrants.revokedAt)),
    ),
    scalar(
      db
        .select({ n: countDistinct(sanctions.userId) })
        .from(sanctions)
        .where(activeSanctionWhere),
    ),
    scalar(db.select({ n: count() }).from(userTable).where(eq(userTable.status, 'suspended'))),
    scalar(db.select({ n: count() }).from(userTrust).where(eq(userTrust.locked, true))),
  ]);
  const countByFilter: Record<FilterKey, number> = {
    '': totalCount,
    staff: staffCount,
    sanctioned: sanctionedCount,
    suspended: suspendedCount,
    locked: lockedCount,
  };

  // 组合查询条件：搜索词 + 当前筛选
  const conds = [];
  if (q.length > 0) {
    conds.push(or(ilike(userTable.name, `%${q}%`), ilike(userTable.email, `%${q}%`)));
  }
  if (filter === 'staff') {
    conds.push(
      inArray(
        userTable.id,
        db.select({ id: roleGrants.userId }).from(roleGrants).where(isNull(roleGrants.revokedAt)),
      ),
    );
  } else if (filter === 'sanctioned') {
    conds.push(
      inArray(
        userTable.id,
        db.select({ id: sanctions.userId }).from(sanctions).where(activeSanctionWhere),
      ),
    );
  } else if (filter === 'suspended') {
    conds.push(eq(userTable.status, 'suspended'));
  } else if (filter === 'locked') {
    conds.push(eq(userTrust.locked, true));
  }
  const whereExpr = conds.length > 0 ? and(...conds) : undefined;

  const users = await db
    .select({
      id: userTable.id,
      name: userTable.name,
      email: userTable.email,
      status: userTable.status,
      createdAt: userTable.createdAt,
      level: userTrust.level,
      locked: userTrust.locked,
    })
    .from(userTable)
    .leftJoin(userTrust, eq(userTrust.userId, userTable.id))
    .where(whereExpr)
    .orderBy(desc(userTable.createdAt))
    .limit(PAGE_SIZE + 1)
    .offset((page - 1) * PAGE_SIZE);
  const hasNext = users.length > PAGE_SIZE;
  const pageUsers = users.slice(0, PAGE_SIZE);
  const pageIds = pageUsers.map((u) => u.id);

  // 当前页用户的：角色、活跃制裁、已发布文章数（仅按页内 id 取，省查询）
  const [grantRows, sanctionRows, docCountRows, sectionOpts] = await Promise.all([
    pageIds.length > 0
      ? db
          .select({
            id: roleGrants.id,
            userId: roleGrants.userId,
            role: roleGrants.role,
            sectionName: sections.name,
          })
          .from(roleGrants)
          .leftJoin(sections, eq(sections.id, roleGrants.sectionId))
          .where(and(isNull(roleGrants.revokedAt), inArray(roleGrants.userId, pageIds)))
      : Promise.resolve([]),
    pageIds.length > 0
      ? db
          .select({
            id: sanctions.id,
            userId: sanctions.userId,
            kind: sanctions.kind,
            endsAt: sanctions.endsAt,
          })
          .from(sanctions)
          .where(and(isNull(sanctions.revokedAt), inArray(sanctions.userId, pageIds)))
      : Promise.resolve([]),
    pageIds.length > 0
      ? db
          .select({ ownerId: documents.ownerId, n: count() })
          .from(documents)
          .where(and(eq(documents.status, 'published'), inArray(documents.ownerId, pageIds)))
          .groupBy(documents.ownerId)
      : Promise.resolve([]),
    db.select({ id: sections.id, name: sections.name }).from(sections).orderBy(sections.position),
  ]);

  const rolesByUser = new Map<string, RoleView[]>();
  for (const g of grantRows) {
    const list = rolesByUser.get(g.userId) ?? [];
    list.push({ id: g.id, role: g.role, sectionName: g.sectionName });
    rolesByUser.set(g.userId, list);
  }
  const sanctionsByUser = new Map<string, SanctionView[]>();
  for (const s of sanctionRows) {
    if (s.endsAt !== null && s.endsAt <= now) {
      continue; // 已过期不计
    }
    const list = sanctionsByUser.get(s.userId) ?? [];
    list.push({ id: s.id, kind: s.kind });
    sanctionsByUser.set(s.userId, list);
  }
  const docCountByUser = new Map<string, number>();
  for (const d of docCountRows) {
    if (d.ownerId !== null) {
      docCountByUser.set(d.ownerId, Number(d.n));
    }
  }

  // 保留搜索/筛选的链接构造
  const tabHref = (key: FilterKey) => {
    const u = new URLSearchParams();
    if (key.length > 0) {
      u.set('filter', key);
    }
    if (q.length > 0) {
      u.set('q', q);
    }
    const s = u.toString();
    return s.length > 0 ? `/admin/users?${s}` : '/admin/users';
  };
  const pageParams: Record<string, string> = {};
  if (filter.length > 0) {
    pageParams.filter = filter;
  }
  if (q.length > 0) {
    pageParams.q = q;
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <AdminPageHeader
        title="用户管理"
        description="角色任命、制裁、信任等级。可按用户名 / 邮箱搜索，或按分组筛选。"
        actions={
          <form method="get" action="/admin/users" className="flex items-center gap-2">
            {filter.length > 0 ? <input type="hidden" name="filter" value={filter} /> : null}
            <input
              name="q"
              defaultValue={q}
              placeholder="搜索用户名 / 邮箱"
              aria-label="搜索用户"
              className="h-9 w-48 rounded-sm border border-ink-200 bg-paper-50 px-3 text-ink-800 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            />
            <button
              type="submit"
              className="h-9 shrink-0 rounded-sm border border-ink-200 px-3 text-ink-700 text-sm transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
            >
              搜索
            </button>
          </form>
        }
      />

      {/* 分组筛选标签（带计数） */}
      <div className="mt-5 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => {
          const active = f.key === filter;
          return (
            <Link
              key={f.key || 'all'}
              href={tabHref(f.key)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors',
                active
                  ? 'border-brand-300 bg-brand-50 text-brand-800'
                  : 'border-ink-200 text-ink-600 hover:border-brand-300 hover:text-brand-700',
              )}
            >
              {f.label}
              <span
                className={cn(
                  'rounded-full px-1.5 text-xs tabular-nums',
                  active ? 'bg-brand-100 text-brand-800' : 'bg-paper-200 text-ink-500',
                )}
              >
                {countByFilter[f.key]}
              </span>
            </Link>
          );
        })}
      </div>

      {q.length > 0 ? (
        <p className="mt-4 text-ink-500 text-sm">
          「{q}」的搜索结果
          {filter.length > 0 ? `（${FILTERS.find((f) => f.key === filter)?.label}）` : ''}
          {pageUsers.length === 0 ? '：无匹配用户。' : ''}
        </p>
      ) : null}

      {pageUsers.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-4">
          {pageUsers.map((u) => {
            const userRoles = rolesByUser.get(u.id) ?? [];
            const userSanctions = sanctionsByUser.get(u.id) ?? [];
            return (
              <li
                key={u.id}
                className="rounded-lg border border-ink-200 bg-paper-50 p-4 shadow-paper"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Link
                    href={`/u/${u.id}`}
                    className="font-medium text-ink-900 transition-colors hover:text-brand-700"
                  >
                    {u.name}
                  </Link>
                  <span className="text-ink-400">{u.email}</span>
                  <Badge variant="outline">TL{u.level ?? 0}</Badge>
                  {u.locked ? <Badge variant="accent">锁定</Badge> : null}
                  {u.status === 'suspended' ? <Badge variant="accent">已停用</Badge> : null}
                  {userRoles.map((r) => (
                    <Badge key={r.id} variant="brand">
                      {ROLE_LABELS[r.role as StaffRole] ?? r.role}
                      {r.sectionName ? `·${r.sectionName}` : ''}
                    </Badge>
                  ))}
                  {userSanctions.map((s) => (
                    <span
                      key={s.id}
                      className="rounded-full bg-ochre-50 px-2 py-0.5 text-ochre-800 text-xs"
                    >
                      {SANCTION_SHORT[s.kind] ?? s.kind}
                    </span>
                  ))}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-400 text-xs">
                  <span>加入于 {formatDate(u.createdAt)}</span>
                  <span aria-hidden>·</span>
                  <span>已发布 {docCountByUser.get(u.id) ?? 0} 篇</span>
                </div>
                <UserAdminPanel
                  userId={u.id}
                  level={u.level ?? 0}
                  locked={u.locked ?? false}
                  roles={userRoles}
                  sanctions={userSanctions}
                  sections={sectionOpts}
                  canGrantSection={canGrantSection}
                  canGrantGlobal={canGrantGlobal}
                  canSanction={canSanction}
                  canAdjustTrust={canAdjustTrust}
                />
              </li>
            );
          })}
        </ul>
      ) : q.length === 0 ? (
        <p className="mt-8 text-ink-500 text-sm">该分组下暂无用户。</p>
      ) : null}

      <Pagination page={page} hasNext={hasNext} basePath="/admin/users" params={pageParams} />
    </div>
  );
}
