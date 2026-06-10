import { documents, getDb, publishedSnapshots, revisions, user as userTable } from '@harublog/db';
import { Badge } from '@harublog/ui';
import { desc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { revisionKindLabel } from '@/lib/doc-labels';
import { formatDateTime } from '@/lib/format';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

interface HistoryPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: HistoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const db = getDb();
  const rows = await db
    .select({ title: documents.title })
    .from(documents)
    .where(eq(documents.slug, slug))
    .limit(1);
  const doc = rows[0];
  return { title: doc ? `${doc.title} · 修订历史` : '文章不存在' };
}

export default async function HistoryPage({ params }: HistoryPageProps) {
  const { slug } = await params;
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

  // 未发布文档的历史只对作者本人可见；已发布文档的全部谱系公开（全历史可直观追溯）
  if (publishedRevisionId === null) {
    const session = await getSession();
    if (!session || session.user.id !== doc.ownerId) {
      notFound();
    }
  }

  const revisionRows = await db
    .select({
      id: revisions.id,
      seq: revisions.seq,
      kind: revisions.kind,
      message: revisions.message,
      blocksChanged: revisions.blocksChanged,
      createdAt: revisions.createdAt,
      authorName: userTable.name,
    })
    .from(revisions)
    .leftJoin(userTable, eq(userTable.id, revisions.authorId))
    .where(eq(revisions.documentId, doc.id))
    .orderBy(desc(revisions.seq));

  // 每个修订的「上一版」= seq 比它小的最近一个（草稿分支 seq 单调）
  const ascSeqs = revisionRows.map((r) => r.seq).sort((a, b) => a - b);
  const prevSeqOf = new Map<number, number>();
  for (let i = 1; i < ascSeqs.length; i++) {
    const cur = ascSeqs[i];
    const prev = ascSeqs[i - 1];
    if (cur !== undefined && prev !== undefined) {
      prevSeqOf.set(cur, prev);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <header className="border-b border-ink-200 pb-6">
        <p className="text-sm text-ink-500">
          <Link href={`/a/${doc.slug}`} className="hover:text-brand-700">
            ← 返回文章
          </Link>
        </p>
        <h1 className="mt-3 font-serif text-2xl font-semibold text-ink-900">
          {doc.title} · 修订历史
        </h1>
        <p className="mt-2 text-sm text-ink-500">
          全历史可直观追溯：点击任一修订的「对比上一版」查看块级差异。
        </p>
        <p className="mt-3 text-sm">
          <Link href={`/a/${doc.slug}/diff`} className="text-brand-700 hover:text-brand-900">
            打开修订对比 →
          </Link>
        </p>
      </header>

      <ol className="divide-y divide-ink-100">
        {revisionRows.map((rev) => (
          <li key={rev.id} className="flex flex-col gap-1.5 py-5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono font-medium text-ink-800">#{rev.seq}</span>
              <Badge variant="outline">{revisionKindLabel(rev.kind)}</Badge>
              {rev.id === publishedRevisionId ? <Badge variant="brand">当前发布</Badge> : null}
              <span className="text-ink-700">{rev.authorName ?? '佚名'}</span>
              <time dateTime={rev.createdAt.toISOString()} className="text-ink-500">
                {formatDateTime(rev.createdAt)}
              </time>
              <span className="text-ink-500">变更 {rev.blocksChanged} 个块</span>
            </div>
            {rev.message !== null && rev.message.length > 0 ? (
              <p className="text-sm leading-relaxed text-ink-600">{rev.message}</p>
            ) : (
              <p className="text-sm text-ink-400">（无修订说明）</p>
            )}
            {prevSeqOf.has(rev.seq) ? (
              <p className="text-sm">
                <Link
                  href={`/a/${doc.slug}/diff?from=${prevSeqOf.get(rev.seq)}&to=${rev.seq}`}
                  className="text-brand-700 hover:text-brand-900"
                >
                  对比上一版（#{prevSeqOf.get(rev.seq)} → #{rev.seq}）
                </Link>
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      {revisionRows.length === 0 ? (
        <p className="py-10 text-sm text-ink-500">这篇文章还没有任何修订。</p>
      ) : null}
    </div>
  );
}
