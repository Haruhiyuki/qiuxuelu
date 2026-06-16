// 管理后台统一布局：顶部横向导航条（按能力显隐），各子页内容照常在下方渲染。

import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AdminNav, type AdminNavItem } from '@/components/admin/admin-nav';
import { getSession } from '@/lib/session';
import { loadActor, sectionScopeForCapability } from '@/server/actors';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  const actor = await loadActor(session.user.id);
  if (actor === null) {
    redirect('/');
  }

  const has = (cap: Parameters<typeof sectionScopeForCapability>[1]) => {
    const s = sectionScopeForCapability(actor, cap);
    return s === 'all' || s.length > 0;
  };
  const isAdmin = actor.roles.some((r) => r.role === 'admin' || r.role === 'superadmin');

  const items: AdminNavItem[] = [
    { href: '/admin', label: '总览', visible: true },
    { href: '/admin/review', label: '发布审批', visible: has('doc.publish') },
    { href: '/admin/flags', label: '举报', visible: has('flag.review') },
    { href: '/admin/comments', label: '评论复核', visible: has('comment.moderate') },
    { href: '/admin/suggestions', label: '修订审核', visible: has('suggestion.review') },
    { href: '/admin/patrol', label: '巡查', visible: has('queue.claim') },
    { href: '/admin/news', label: '近闻', visible: has('announcement.manage') },
    { href: '/admin/users', label: '用户', visible: isAdmin },
    { href: '/admin/appeals', label: '申诉', visible: isAdmin },
    { href: '/admin/audit', label: '审计', visible: isAdmin },
  ]
    .filter((i) => i.visible)
    .map(({ href, label }) => ({ href, label }));

  return (
    <div>
      <AdminNav items={items} />
      {children}
    </div>
  );
}
