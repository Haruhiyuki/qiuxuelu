// 板块管理（section.manage，admin+）：新建/重命名/移动文章/删除/排序。
import { documents, getDb, sections } from '@harublog/db';
import { can } from '@harublog/domain';
import { asc, eq, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AdminForbidden } from '@/components/admin/admin-forbidden';
import { AdminPageHeader } from '@/components/admin/admin-page-header';
import {
  type SectionDoc,
  SectionManager,
  type SectionRow,
} from '@/components/admin/section-manager';
import { getSession } from '@/lib/session';
import { loadActor } from '@/server/actors';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '板块管理', robots: { index: false } };

export default async function SectionsAdminPage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  const actor = await loadActor(session.user.id);
  if (actor === null || !can(actor, 'section.manage', {}).allow) {
    return <AdminForbidden reason="板块管理需要管理员及以上角色。" />;
  }

  const db = getDb();
  const [rows, docRows] = await Promise.all([
    db
      .select({
        id: sections.id,
        name: sections.name,
        slug: sections.slug,
        description: sections.description,
        position: sections.position,
        docCount: sql<number>`count(${documents.id})::int`,
      })
      .from(sections)
      .leftJoin(documents, eq(documents.sectionId, sections.id))
      .groupBy(sections.id)
      .orderBy(asc(sections.position)),
    db
      .select({
        id: documents.id,
        title: documents.title,
        status: documents.status,
        sectionId: documents.sectionId,
      })
      .from(documents)
      .orderBy(asc(documents.title)),
  ]);

  const initialSections: SectionRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    docCount: Number(r.docCount),
  }));
  const docs: SectionDoc[] = docRows;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <AdminPageHeader
        title="板块管理"
        description="新建、重命名、调整顺序、移动文章所属板块、删除空板块。板块改动即时生效（首页与筛选按 slug）。"
      />
      <div className="mt-6">
        <SectionManager initialSections={initialSections} docs={docs} />
      </div>
    </div>
  );
}
