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
import { loadRevisionDoc } from '@/server/revision-doc';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: '编辑文章' };

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
          这篇文章不属于你。仅作者本人可直接编辑，对他人文章可提交修订申请。
        </p>
        <p className="mt-6">
          <Link href="/write" className="text-brand-700 hover:text-brand-900">
            ← 返回草稿箱
          </Link>
        </p>
      </div>
    );
  }

  const [wcRows, refRows] = await Promise.all([
    db
      .select({ content: workingCopies.content })
      .from(workingCopies)
      .where(and(eq(workingCopies.documentId, docId), eq(workingCopies.userId, session.user.id)))
      .limit(1),
    db
      .select({ revisionId: documentRefs.revisionId })
      .from(documentRefs)
      .where(and(eq(documentRefs.documentId, docId), eq(documentRefs.name, 'draft')))
      .limit(1),
  ]);
  const draftHead = refRows[0]?.revisionId ?? null;

  let headSeq: number | null = null;
  if (draftHead !== null) {
    const seqRows = await db
      .select({ seq: revisions.seq })
      .from(revisions)
      .where(eq(revisions.id, draftHead))
      .limit(1);
    headSeq = seqRows[0]?.seq ?? null;
  }

  // 工作副本缺失时从 draft 头修订重建（块 id 为库内 uuid，提交侧原样沿用以保身份稳定）
  let rawInitial: unknown = wcRows[0]?.content ?? null;
  if (rawInitial === null) {
    rawInitial = draftHead !== null ? await loadRevisionDoc(db, draftHead) : EMPTY_DOC;
  }
  let initialDoc: DocJson;
  try {
    initialDoc = validateDoc(rawInitial);
  } catch {
    initialDoc = EMPTY_DOC;
  }
  const tags = await getDocumentTags(doc.id);
  const sectionOptions: SectionOption[] = sectionRows;

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
      hasRevisions={draftHead !== null}
      headSeq={headSeq}
    />
  );
}
