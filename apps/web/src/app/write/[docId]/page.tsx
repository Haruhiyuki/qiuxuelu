import { documentRefs, documents, getDb, revisions, sections, workingCopies } from '@harublog/db';
import type { DocJson } from '@harublog/kernel';
import { validateDoc } from '@harublog/kernel';
import { and, asc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import type { SectionOption } from '@/components/editor/article-composer';
import { ComposerClient } from '@/components/editor/composer-client';
import { getSession } from '@/lib/session';
import { getDocumentTags } from '@/server/actions/tags';
import { loadActor } from '@/server/actors';
import { loadRevisionDoc } from '@/server/revision-doc';
import { loadSeriesPicker } from '@/server/series';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: '编辑博客' };

interface EditPageProps {
  params: Promise<{ docId: string }>;
}

const EMPTY_DOC: DocJson = { type: 'doc', content: [] };

export default async function EditDocumentPage({ params }: EditPageProps) {
  const { docId } = await params;
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  if (!z.uuid().safeParse(docId).success) {
    notFound();
  }

  const db = getDb();
  const [docRows, sectionRows] = await Promise.all([
    db
      .select({
        id: documents.id,
        title: documents.title,
        summary: documents.summary,
        sectionId: documents.sectionId,
        status: documents.status,
        ownerId: documents.ownerId,
      })
      .from(documents)
      .where(eq(documents.id, docId))
      .limit(1),
    db
      .select({ id: sections.id, name: sections.name })
      .from(sections)
      .orderBy(asc(sections.position)),
  ]);
  const doc = docRows[0];
  if (!doc) {
    notFound();
  }
  if (doc.ownerId !== session.user.id) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-20 text-center">
        <h1 className="font-semibold font-serif text-2xl text-ink-900">无权编辑</h1>
        <p className="mt-3 text-ink-500 text-sm leading-relaxed">
          这篇博客不属于你。仅作者本人可直接编辑，对他人博客可提交修订申请。
        </p>
        <p className="mt-6">
          <Link href="/write" className="text-brand-700 hover:text-brand-900">
            ← 返回草稿箱
          </Link>
        </p>
      </div>
    );
  }

  // 已发布博客继续编辑时，工作基线应取当前 published 头；修订提交后会直接生效。
  // 未发布草稿仍取 draft 头，首发走发布申请/自助发布。
  const headRefName = doc.status === 'published' ? 'published' : 'draft';
  const [wcRows, refRows] = await Promise.all([
    db
      .select({ content: workingCopies.content })
      .from(workingCopies)
      .where(and(eq(workingCopies.documentId, docId), eq(workingCopies.userId, session.user.id)))
      .limit(1),
    db
      .select({ revisionId: documentRefs.revisionId })
      .from(documentRefs)
      .where(and(eq(documentRefs.documentId, docId), eq(documentRefs.name, headRefName)))
      .limit(1),
  ]);
  const headRevisionId = refRows[0]?.revisionId ?? null;

  let headSeq: number | null = null;
  if (headRevisionId !== null) {
    const seqRows = await db
      .select({ seq: revisions.seq })
      .from(revisions)
      .where(eq(revisions.id, headRevisionId))
      .limit(1);
    headSeq = seqRows[0]?.seq ?? null;
  }

  // 工作副本缺失时从当前头修订重建（块 id 为库内 uuid，提交侧原样沿用以保身份稳定）
  let rawInitial: unknown = wcRows[0]?.content ?? null;
  if (rawInitial === null) {
    rawInitial = headRevisionId !== null ? await loadRevisionDoc(db, headRevisionId) : EMPTY_DOC;
  }
  let initialDoc: DocJson;
  try {
    initialDoc = validateDoc(rawInitial);
  } catch {
    initialDoc = EMPTY_DOC;
  }
  const tags = await getDocumentTags(doc.id);
  const sectionOptions: SectionOption[] = sectionRows;
  // T2+ 免预审：直接发布（ADR-0010）
  const actor = await loadActor(session.user.id);
  const canSelfPublish = (actor?.trustLevel ?? 0) >= 2;
  // 博客系列（ADR-0014）：作者的系列选项 + 本文当前所属系列
  const seriesPicker = await loadSeriesPicker(session.user.id, doc.id);

  return (
    <ComposerClient
      docId={doc.id}
      sections={sectionOptions}
      initialTitle={doc.title}
      initialSectionId={doc.sectionId}
      initialSummary={doc.summary ?? ''}
      initialTags={tags}
      initialDoc={initialDoc}
      status={doc.status}
      hasRevisions={headRevisionId !== null}
      headSeq={headSeq}
      canSelfPublish={canSelfPublish}
      seriesOptions={seriesPicker.options}
      currentSeriesId={seriesPicker.currentSeriesId}
    />
  );
}
