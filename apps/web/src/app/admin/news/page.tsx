// 管理后台 · 近闻：发布/管理站点新闻与公告（announcement.manage，管理员+）。
import { getDb } from '@harublog/db';
import { can } from '@harublog/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AdminForbidden } from '@/components/admin/admin-forbidden';
import { AdminPageHeader } from '@/components/admin/admin-page-header';
import { AnnouncementManager } from '@/components/admin/announcement-manager';
import { getSession } from '@/lib/session';
import { loadActor } from '@/server/actors';
import { listAllAnnouncements } from '@/server/announcements';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '近闻管理', robots: { index: false } };

export default async function AdminNewsPage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  const actor = await loadActor(session.user.id);
  if (actor === null || !can(actor, 'announcement.manage', {}).allow) {
    return <AdminForbidden reason="发布站点公告需要管理员及以上角色。" />;
  }

  const items = await listAllAnnouncements(getDb());

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <AdminPageHeader
        title="近闻管理"
        count={items.length}
        description={
          <>
            发布的公告进
            <Link href="/news" className="mx-1 text-brand-700 hover:text-brand-900">
              近闻页
            </Link>
            ；置顶的会显示在首页公告栏（取最新一条）。
          </>
        }
      />
      <div className="mt-8">
        <AnnouncementManager items={items} />
      </div>
    </div>
  );
}
