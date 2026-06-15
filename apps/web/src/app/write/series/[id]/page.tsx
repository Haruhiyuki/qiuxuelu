// 系列管理页（ADR-0014）：仅系列所有者可进。提供改名/简介、重排、移出、加入已有、系列内新建、删除。
import { documents, getDb, sections, series, seriesItems } from '@harublog/db';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { Breadcrumb } from '@/components/breadcrumb';
import { type ManagerItem, SeriesManager } from '@/components/series/series-manager';
import { getSession } from '@/lib/session';
import { loadSeriesItems } from '@/server/series';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: '管理系列' };

interface ManagePageProps {
  params: Promise<{ id: string }>;
}

export default async function ManageSeriesPage({ params }: ManagePageProps) {
  const { id } = await params;
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  if (!z.uuid().safeParse(id).success) {
    notFound();
  }
  const db = getDb();
  const headRows = await db
    .select({
      id: series.id,
      ownerId: series.ownerId,
      slug: series.slug,
      title: series.title,
      description: series.description,
    })
    .from(series)
    .where(eq(series.id, id))
    .limit(1);
  const head = headRows[0];
  if (head === undefined || head.ownerId !== session.user.id) {
    notFound();
  }

  const [itemRows, candRows, sectionRows] = await Promise.all([
    loadSeriesItems(head.id),
    // 候选 = 本人「未归入任何系列」的文章（避免误把已在别系列的文章悄悄迁走）
    db
      .select({ id: documents.id, title: documents.title, status: documents.status })
      .from(documents)
      .leftJoin(seriesItems, eq(seriesItems.documentId, documents.id))
      .where(and(eq(documents.ownerId, session.user.id), isNull(seriesItems.documentId)))
      .orderBy(desc(documents.updatedAt)),
    db
      .select({ id: sections.id, name: sections.name })
      .from(sections)
      .orderBy(asc(sections.position)),
  ]);

  const items: ManagerItem[] = itemRows.map((it) => ({
    documentId: it.documentId,
    title: it.title,
    status: it.status,
    slug: it.slug,
  }));

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <Breadcrumb
        items={[
          { label: '我的写作', href: '/write' },
          { label: '我的系列', href: '/write/series' },
          { label: head.title },
        ]}
      />
      <SeriesManager
        seriesId={head.id}
        slug={head.slug}
        initialTitle={head.title}
        initialDescription={head.description ?? ''}
        initialItems={items}
        candidates={candRows}
        sections={sectionRows}
      />
    </div>
  );
}
