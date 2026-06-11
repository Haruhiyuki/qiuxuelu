import { documents, getDb, sections, suggestions, user as userTable } from '@harublog/db';
import { Badge, EmptyState } from '@harublog/ui';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { GitPullRequest } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { formatDateTime } from '@/lib/format';
import { getSession } from '@/lib/session';
import { loadActor, sectionScopeForCapability } from '@/server/actors';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '建议审校', robots: { index: false } };

const STATUS_LABEL: Record<string, string> = {
  open: '待审',
  under_review: '审校中',
  changes_requested: '已要求修改',
  outdated: '已过期',
};

function Forbidden() {
  return (
    <div className="mx-auto w-full max-w-xl px-6 py-20 text-center">
      <h1 className="font-serif text-2xl text-ink-900">无权访问</h1>
      <p className="mt-3 text-ink-500 text-sm">建议审校需要编辑及以上角色。</p>
      <p className="mt-6 text-sm">
        <Link href="/" className="text-brand-700 hover:text-brand-900">
          ← 返回首页
        </Link>
      </p>
    </div>
  );
}

export default async function SuggestionQueuePage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  const actor = await loadActor(session.user.id);
  if (actor === null) {
    return <Forbidden />;
  }
  const scope = sectionScopeForCapability(actor, 'suggestion.review');
  if (scope !== 'all' && scope.length === 0) {
    return <Forbidden />;
  }

  const db = getDb();
  const activeStatuses = ['open', 'under_review', 'changes_requested', 'outdated'] as const;
  const rows = await db
    .select({
      id: suggestions.id,
      status: suggestions.status,
      note: suggestions.note,
      createdAt: suggestions.createdAt,
      authorName: userTable.name,
      docTitle: documents.title,
      sectionName: sections.name,
    })
    .from(suggestions)
    .innerJoin(documents, eq(documents.id, suggestions.documentId))
    .leftJoin(sections, eq(sections.id, documents.sectionId))
    .leftJoin(userTable, eq(userTable.id, suggestions.authorId))
    .where(
      scope === 'all'
        ? inArray(suggestions.status, [...activeStatuses])
        : and(
            inArray(suggestions.status, [...activeStatuses]),
            inArray(documents.sectionId, scope),
          ),
    )
    .orderBy(asc(suggestions.createdAt));

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <header className="border-ink-200 border-b pb-6">
        <p className="text-ink-500 text-sm">
          <Link href="/admin" className="hover:text-brand-700">
            ← 管理后台
          </Link>
        </p>
        <h1 className="mt-2 font-semibold font-serif text-2xl text-ink-900">建议审校</h1>
        <p className="mt-2 text-ink-500 text-sm">
          待处理 {rows.length} 项 · 点击进入逐条审校与合入
        </p>
      </header>

      {rows.length === 0 ? (
        <EmptyState
          icon={<GitPullRequest />}
          title="没有待审建议"
          description="当前建议队列为空。"
        />
      ) : (
        <ul className="mt-4 divide-y divide-ink-100">
          {rows.map((r) => (
            <li key={r.id} className="py-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="outline">{STATUS_LABEL[r.status] ?? r.status}</Badge>
                {r.sectionName ? <span className="text-ink-500">{r.sectionName}</span> : null}
                <span className="text-ink-700">{r.authorName ?? '佚名'}</span>
                <time dateTime={r.createdAt.toISOString()} className="text-ink-400">
                  {formatDateTime(r.createdAt)}
                </time>
              </div>
              <Link
                href={`/suggestions/${r.id}`}
                className="mt-1 block font-serif text-ink-900 hover:text-brand-700"
              >
                {r.docTitle}
              </Link>
              {r.note ? <p className="mt-0.5 text-ink-500 text-sm">{r.note}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
