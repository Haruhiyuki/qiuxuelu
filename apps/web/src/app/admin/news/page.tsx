// 管理后台 · 近闻：发布/管理站点新闻与公告（announcement.manage，管理员+）。
import { getDb } from '@harublog/db';
import { can } from '@harublog/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
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
    return (
      <div className="mx-auto w-full max-w-xl px-6 py-20 text-center">
        <h1 className="font-semibold font-serif text-2xl text-ink-900">无权访问</h1>
        <p className="mt-3 text-ink-500 text-sm">发布站点公告需要管理员及以上角色。</p>
        <p className="mt-6">
          <Link href="/admin" className="text-brand-700 hover:text-brand-900">
            ← 返回管理后台
          </Link>
        </p>
      </div>
    );
  }

  const items = await listAllAnnouncements(getDb());

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <header className="border-ink-200 border-b pb-6">
        <h1 className="font-semibold font-serif text-2xl text-ink-900">近闻管理</h1>
        <p className="mt-2 text-ink-500 text-sm">
          发布的公告进
          <Link href="/news" className="mx-1 text-brand-700 hover:text-brand-900">
            近闻页
          </Link>
          ；置顶的会显示在首页公告栏（取最新一条）。
        </p>
      </header>
      <div className="mt-8">
        <AnnouncementManager items={items} />
      </div>
    </div>
  );
}
