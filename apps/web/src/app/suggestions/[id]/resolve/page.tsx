import { blobs, documentRefs, documents, getDb, revisionBlocks, suggestions } from '@harublog/db';
import { can } from '@harublog/domain';
import { type ManifestEntry, threeWayMerge } from '@harublog/kernel';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  type ConflictBlockView,
  ConflictResolver,
} from '@/components/suggestions/conflict-resolver';
import { getSession } from '@/lib/session';
import { loadActor } from '@/server/actors';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '冲突裁决', robots: { index: false } };

interface ResolvePageProps {
  params: Promise<{ id: string }>;
}

async function entriesOf(
  db: ReturnType<typeof getDb>,
  revisionId: string,
): Promise<ManifestEntry[]> {
  const rows = await db
    .select({ blockId: revisionBlocks.blockId, hash: revisionBlocks.blobHash })
    .from(revisionBlocks)
    .where(eq(revisionBlocks.revisionId, revisionId))
    .orderBy(asc(revisionBlocks.position));
  return rows.map((r) => ({ blockId: r.blockId, hash: r.hash }));
}

export default async function ResolvePage({ params }: ResolvePageProps) {
  const { id } = await params;
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const db = getDb();
  const sgRows = await db
    .select({
      id: suggestions.id,
      documentId: suggestions.documentId,
      authorId: suggestions.authorId,
      baseRevisionId: suggestions.baseRevisionId,
      headRevisionId: suggestions.headRevisionId,
      status: suggestions.status,
      sectionId: documents.sectionId,
      ownerId: documents.ownerId,
      slug: documents.slug,
      title: documents.title,
    })
    .from(suggestions)
    .innerJoin(documents, eq(documents.id, suggestions.documentId))
    .where(eq(suggestions.id, id))
    .limit(1);
  const sg = sgRows[0];
  if (!sg) {
    notFound();
  }

  const actor = await loadActor(session.user.id);
  const canReview =
    actor !== null &&
    can(actor, 'suggestion.merge', {
      sectionId: sg.sectionId,
      doc: {
        id: sg.documentId,
        ownerId: sg.ownerId ?? '',
        editPolicy: 'suggest_only',
        status: 'published',
      },
    }).allow;
  if (!canReview || sg.authorId === session.user.id) {
    notFound();
  }

  const oursHead = (
    await db
      .select({ revisionId: documentRefs.revisionId })
      .from(documentRefs)
      .where(and(eq(documentRefs.documentId, sg.documentId), eq(documentRefs.name, 'published')))
      .limit(1)
  )[0]?.revisionId;
  if (oursHead === undefined) {
    notFound();
  }

  const [base, ours, theirs] = await Promise.all([
    entriesOf(db, sg.baseRevisionId),
    entriesOf(db, oursHead),
    entriesOf(db, sg.headRevisionId),
  ]);
  const merge = threeWayMerge(base, ours, theirs);
  // 无冲突 → 可直接（快进/自动变基）合入，无需裁决
  if (merge.conflicts.length === 0) {
    redirect(`/suggestions/${id}`);
  }

  // 取冲突块各版本文本
  const hashes = new Set<string>();
  for (const c of merge.conflicts) {
    if (c.oursHash) hashes.add(c.oursHash);
    if (c.theirsHash) hashes.add(c.theirsHash);
  }
  const textRows =
    hashes.size > 0
      ? await db
          .select({ hash: blobs.hash, text: blobs.textPlain })
          .from(blobs)
          .where(inArray(blobs.hash, [...hashes]))
      : [];
  const textByHash = new Map(textRows.map((r) => [r.hash, r.text]));
  const conflicts: ConflictBlockView[] = merge.conflicts.map((c) => ({
    blockId: c.blockId,
    oursText: c.oursHash ? (textByHash.get(c.oursHash) ?? '') : null,
    theirsText: c.theirsHash ? (textByHash.get(c.theirsHash) ?? '') : null,
  }));

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <header className="border-ink-200 border-b pb-6">
        <p className="text-ink-500 text-sm">
          <Link href={`/suggestions/${id}`} className="hover:text-brand-700">
            ← 返回建议
          </Link>
        </p>
        <h1 className="mt-2 font-semibold font-serif text-2xl text-ink-900">
          冲突裁决：{sg.title}
        </h1>
        <p className="mt-2 text-ink-500 text-sm">
          主线在这份建议提出后已前移，且与建议改动落在同一段。请逐处选择保留主线还是建议，然后合入。
        </p>
      </header>

      <div className="py-6">
        <ConflictResolver suggestionId={sg.id} slug={sg.slug} conflicts={conflicts} />
      </div>
    </div>
  );
}
