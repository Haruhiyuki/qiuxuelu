import { getDb, sections } from '@harublog/db';
import type { DocJson } from '@harublog/kernel';
import { asc } from 'drizzle-orm';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { SectionOption } from '@/components/editor/article-composer';
import { ComposerClient } from '@/components/editor/composer-client';
import { getSession } from '@/lib/session';
import { loadActor } from '@/server/actors';
import { listUserSeries } from '@/server/series';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: '写文章' };

const EMPTY_DOC: DocJson = { type: 'doc', content: [] };

// 直接进入空白写作台（不在渲染期建文档：懒创建在客户端首次编辑时触发，避免空草稿/预取副作用）
export default async function NewDocumentPage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  const sectionRows = await getDb()
    .select({ id: sections.id, name: sections.name })
    .from(sections)
    .orderBy(asc(sections.position));
  const sectionOptions: SectionOption[] = sectionRows;
  // T2+ 免预审：直接发布（ADR-0010）
  const actor = await loadActor(session.user.id);
  const canSelfPublish = (actor?.trustLevel ?? 0) >= 2;
  // 文章系列（ADR-0014）：作者的现有系列，供新文就地归类（也可在抽屉里新建）
  const mySeries = await listUserSeries(session.user.id);

  return (
    <ComposerClient
      docId={null}
      sections={sectionOptions}
      initialTitle=""
      initialSectionId={sectionOptions[0]?.id ?? ''}
      initialSummary=""
      initialTags={[]}
      initialDoc={EMPTY_DOC}
      status="draft"
      hasRevisions={false}
      headSeq={null}
      canSelfPublish={canSelfPublish}
      seriesOptions={mySeries.map((s) => ({ id: s.id, title: s.title }))}
      currentSeriesId={null}
    />
  );
}
