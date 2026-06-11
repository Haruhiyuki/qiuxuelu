import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { loadActor, sectionScopeForCapability } from '@/server/actors';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '管理后台', robots: { index: false } };

interface Tile {
  href: string;
  title: string;
  desc: string;
  visible: boolean;
}

export default async function AdminHome() {
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

  const tiles: Tile[] = [
    {
      href: '/admin/review',
      title: '发布审批',
      desc: '审批新文章与改版的发布申请',
      visible: has('doc.publish'),
    },
    {
      href: '/admin/flags',
      title: '举报处理',
      desc: '裁决举报、隐藏或恢复内容',
      visible: has('flag.review'),
    },
    {
      href: '/admin/suggestions',
      title: '建议审校',
      desc: '审校编辑建议并合入正文',
      visible: has('suggestion.review'),
    },
    {
      href: '/admin/patrol',
      title: '巡查队列',
      desc: '复核协作直编，必要时回退',
      visible: has('queue.claim'),
    },
    { href: '/admin/users', title: '用户管理', desc: '角色任命、制裁、信任等级', visible: isAdmin },
    { href: '/admin/audit', title: '审计日志', desc: '高危操作的可追溯记录', visible: isAdmin },
  ];
  const visible = tiles.filter((t) => t.visible);
  if (visible.length === 0) {
    redirect('/');
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <h1 className="font-semibold font-serif text-2xl text-ink-900">管理后台</h1>
      <p className="mt-2 text-ink-500 text-sm">按你的角色显示可用的治理工具。</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {visible.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="rounded-sm border border-ink-200 bg-paper-50 p-5 transition-colors hover:border-brand-400"
          >
            <p className="font-medium font-serif text-ink-900 text-lg">{t.title}</p>
            <p className="mt-1 text-ink-500 text-sm">{t.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
