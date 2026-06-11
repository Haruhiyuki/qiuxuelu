import { documents, getDb, sections, suggestions } from '@harublog/db';
import { Badge, EmptyState } from '@harublog/ui';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { PenLine } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Breadcrumb } from '@/components/breadcrumb';
import { NewDocumentForm } from '@/components/new-document-form';
import { docStatusLabel } from '@/lib/doc-labels';
import { formatDate } from '@/lib/format';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: '我的写作' };

const STATUS_BADGE_VARIANT: Record<string, 'default' | 'brand' | 'accent' | 'outline'> = {
  draft: 'default',
  pending: 'accent',
  published: 'brand',
  archived: 'outline',
};

export default async function WritePage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const db = getDb();
  const [myDocs, sectionRows] = await Promise.all([
    db
      .select({
        id: documents.id,
        title: documents.title,
        slug: documents.slug,
        status: documents.status,
        updatedAt: documents.updatedAt,
        sectionName: sections.name,
      })
      .from(documents)
      .innerJoin(sections, eq(sections.id, documents.sectionId))
      .where(eq(documents.ownerId, session.user.id))
      .orderBy(desc(documents.updatedAt)),
    db
      .select({ id: sections.id, name: sections.name })
      .from(sections)
      .orderBy(asc(sections.position)),
  ]);

  // 我提交的、仍在流转中的编辑建议
  const myActiveStatuses = ['open', 'under_review', 'changes_requested', 'outdated'] as const;
  const mySuggestions = await db
    .select({
      id: suggestions.id,
      status: suggestions.status,
      docTitle: documents.title,
      createdAt: suggestions.createdAt,
    })
    .from(suggestions)
    .innerJoin(documents, eq(documents.id, suggestions.documentId))
    .where(
      and(
        eq(suggestions.authorId, session.user.id),
        inArray(suggestions.status, [...myActiveStatuses]),
      ),
    )
    .orderBy(desc(suggestions.createdAt));
  const sgStatusLabel: Record<string, string> = {
    open: '待审',
    under_review: '审校中',
    changes_requested: '待修改',
    outdated: '已过期',
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <Breadcrumb items={[{ label: '首页', href: '/' }, { label: '我的写作' }]} />
      <header className="border-b border-ink-200 pb-8">
        <h1 className="font-serif text-2xl font-semibold text-ink-900">我的写作</h1>
        <p className="mt-2 text-sm text-ink-500">
          草稿自动保存，显式提交修订形成历史；申请发布后由志愿者审校上线。
        </p>
      </header>

      <div className="grid grid-cols-1 gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section>
          <h2 className="font-serif text-lg font-semibold text-ink-900">我的文章</h2>
          {myDocs.length > 0 ? (
            <ul className="mt-2 divide-y divide-ink-100">
              {myDocs.map((doc) => (
                <li key={doc.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div className="min-w-0">
                    <Link
                      href={`/write/${doc.id}`}
                      className="font-serif text-base font-semibold text-ink-900 hover:text-brand-700"
                    >
                      {doc.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                      <Badge variant={STATUS_BADGE_VARIANT[doc.status] ?? 'default'}>
                        {docStatusLabel(doc.status)}
                      </Badge>
                      <span>{doc.sectionName}</span>
                      <time dateTime={doc.updatedAt.toISOString()}>
                        更新于 {formatDate(doc.updatedAt)}
                      </time>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <Link href={`/write/${doc.id}`} className="text-brand-700 hover:text-brand-900">
                      继续编辑
                    </Link>
                    {doc.status === 'published' ? (
                      <Link href={`/a/${doc.slug}`} className="text-ink-500 hover:text-brand-700">
                        查看文章
                      </Link>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<PenLine />}
              title="还没有文章"
              description="从右侧新建第一篇——写下走过的路，就是后来者的地图。"
            />
          )}
        </section>

        <aside className="flex flex-col gap-6">
          <section className="rounded-sm border border-ink-200 bg-paper-50 p-5">
            <h2 className="font-serif text-lg font-semibold text-ink-900">新建文章</h2>
            <div className="mt-4">
              <NewDocumentForm sections={sectionRows} />
            </div>
          </section>

          {mySuggestions.length > 0 ? (
            <section className="rounded-sm border border-ink-200 bg-paper-50 p-5">
              <h2 className="font-serif text-lg font-semibold text-ink-900">我的编辑建议</h2>
              <ul className="mt-3 flex flex-col gap-3">
                {mySuggestions.map((s) => (
                  <li key={s.id} className="text-sm">
                    <Link
                      href={`/suggestions/${s.id}`}
                      className="text-ink-800 hover:text-brand-700"
                    >
                      {s.docTitle}
                    </Link>
                    <span className="ml-2 text-ink-400 text-xs">
                      {sgStatusLabel[s.status] ?? s.status}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
