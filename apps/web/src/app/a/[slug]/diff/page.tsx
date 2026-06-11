import { documents, getDb, publishedSnapshots, revisions } from '@harublog/db';
import { buildRevisionDiff } from '@harublog/kernel';
import { RevisionDiffView } from '@harublog/renderer';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/lib/session';
import { loadRevisionBlocks } from '@/server/revision-doc';

export const dynamic = 'force-dynamic';

interface DiffPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}

export async function generateMetadata({ params }: DiffPageProps): Promise<Metadata> {
  const { slug } = await params;
  const db = getDb();
  const rows = await db
    .select({ title: documents.title })
    .from(documents)
    .where(eq(documents.slug, slug))
    .limit(1);
  const doc = rows[0];
  // 修订对比页不进搜索引擎索引（防内容重复，架构 §7）
  return { title: doc ? `${doc.title} · 修订对比` : '文章不存在', robots: { index: false } };
}

export default async function DiffPage({ params, searchParams }: DiffPageProps) {
  const { slug } = await params;
  const { from: fromParam, to: toParam } = await searchParams;
  const db = getDb();

  const docRows = await db
    .select({
      id: documents.id,
      title: documents.title,
      slug: documents.slug,
      ownerId: documents.ownerId,
    })
    .from(documents)
    .where(eq(documents.slug, slug))
    .limit(1);
  const doc = docRows[0];
  if (!doc) {
    notFound();
  }

  const snapshotRows = await db
    .select({ revisionId: publishedSnapshots.revisionId })
    .from(publishedSnapshots)
    .where(eq(publishedSnapshots.documentId, doc.id))
    .limit(1);
  const publishedRevisionId = snapshotRows[0]?.revisionId ?? null;

  // 未发布文档的对比只对作者本人可见（与历史页一致）
  if (publishedRevisionId === null) {
    const session = await getSession();
    if (!session || session.user.id !== doc.ownerId) {
      notFound();
    }
  }

  const revRows = await db
    .select({ id: revisions.id, seq: revisions.seq, message: revisions.message })
    .from(revisions)
    // 只对比主线修订；建议分支不进对比选择器（ADR-0004）
    .where(and(eq(revisions.documentId, doc.id), isNull(revisions.suggestionId)))
    .orderBy(desc(revisions.seq));
  if (revRows.length < 2) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <BackLink slug={doc.slug} />
        <h1 className="mt-3 font-serif text-2xl font-semibold text-ink-900">
          {doc.title} · 修订对比
        </h1>
        <p className="mt-6 text-sm text-ink-500">这篇文章只有一个修订，暂无可对比的版本。</p>
      </div>
    );
  }

  const seqToId = new Map(revRows.map((r) => [r.seq, r.id]));
  const latestSeq = revRows[0]?.seq ?? 0;
  const toSeq = parseSeq(toParam, latestSeq, seqToId);
  // 默认 from = to 的前一号修订（草稿分支 seq 单调）
  const defaultFromSeq = revRows.find((r) => r.seq < toSeq)?.seq ?? toSeq;
  const fromSeq = parseSeq(fromParam, defaultFromSeq, seqToId);

  const fromId = seqToId.get(fromSeq);
  const toId = seqToId.get(toSeq);
  if (fromId === undefined || toId === undefined) {
    notFound();
  }

  const [beforeBlocks, afterBlocks] = await Promise.all([
    loadRevisionBlocks(db, fromId),
    loadRevisionBlocks(db, toId),
  ]);
  const diff = buildRevisionDiff(beforeBlocks, afterBlocks);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <header className="border-b border-ink-200 pb-6">
        <BackLink slug={doc.slug} />
        <h1 className="mt-3 font-serif text-2xl font-semibold text-ink-900">
          {doc.title} · 修订对比
        </h1>
        <form method="get" className="mt-4 flex flex-wrap items-end gap-3 text-sm">
          <span className="flex flex-col gap-1">
            <label htmlFor="diff-from" className="text-ink-500">
              旧版本
            </label>
            <RevisionSelect id="diff-from" name="from" current={fromSeq} options={revRows} />
          </span>
          <span className="pb-2 text-ink-400" aria-hidden>
            →
          </span>
          <span className="flex flex-col gap-1">
            <label htmlFor="diff-to" className="text-ink-500">
              新版本
            </label>
            <RevisionSelect id="diff-to" name="to" current={toSeq} options={revRows} />
          </span>
          <button
            type="submit"
            className="rounded-sm border border-ink-300 px-3 py-1.5 font-medium text-ink-700 hover:bg-paper-200"
          >
            对比
          </button>
        </form>
      </header>

      <div className="py-6">
        <RevisionDiffView diff={diff} />
      </div>
    </div>
  );
}

function parseSeq(raw: string | undefined, fallback: number, valid: Map<number, string>): number {
  if (raw === undefined) {
    return fallback;
  }
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && valid.has(n) ? n : fallback;
}

function BackLink({ slug }: { slug: string }) {
  return (
    <p className="text-sm text-ink-500">
      <Link href={`/a/${slug}/history`} className="hover:text-brand-700">
        ← 返回修订历史
      </Link>
    </p>
  );
}

function RevisionSelect({
  id,
  name,
  current,
  options,
}: {
  id: string;
  name: string;
  current: number;
  options: { seq: number; message: string | null }[];
}) {
  return (
    <select
      id={id}
      name={name}
      defaultValue={current}
      className="rounded-sm border border-ink-300 bg-paper-50 px-2 py-1.5 text-ink-800"
    >
      {options.map((r) => (
        <option key={r.seq} value={r.seq}>
          #{r.seq}
          {r.message ? ` · ${r.message.slice(0, 20)}` : ''}
        </option>
      ))}
    </select>
  );
}
