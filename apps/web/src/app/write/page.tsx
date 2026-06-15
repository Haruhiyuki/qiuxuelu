import { documents, getDb, revisions, sections, suggestions, workingCopies } from '@harublog/db';
import { Badge, EmptyState } from '@harublog/ui';
import { and, desc, eq, inArray, isNull, max } from 'drizzle-orm';
import { Layers, PenLine } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Breadcrumb } from '@/components/breadcrumb';
import { ButtonLink } from '@/components/button-link';
import { DeleteDraftButton } from '@/components/delete-draft-button';
import { formatDateTime } from '@/lib/format';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: '创作中心' };

interface DocRow {
  id: string;
  title: string;
  slug: string;
  status: string;
  updatedAt: Date;
  sectionName: string;
  /** 工作副本最后自动保存时刻（无副本为 null） */
  wcUpdatedAt: Date | null;
  /** 最新主线修订时刻（从未提交为 null） */
  lastRevisionAt: Date | null;
}

/** 有未提交的修改 = 工作副本比最新主线修订更新（提交只回写 baseRevisionId 不动 updatedAt） */
function hasUncommitted(doc: DocRow): boolean {
  if (doc.wcUpdatedAt === null) {
    return false;
  }
  return doc.lastRevisionAt === null || doc.wcUpdatedAt > doc.lastRevisionAt;
}

/** 草稿箱排序/展示用的「上次编辑」时刻：自动保存与文档更新取较新者 */
function lastEditedAt(doc: DocRow): Date {
  return doc.wcUpdatedAt !== null && doc.wcUpdatedAt > doc.updatedAt
    ? doc.wcUpdatedAt
    : doc.updatedAt;
}

function DocList({ docs, kind }: { docs: DocRow[]; kind: 'draft' | 'pending' | 'published' }) {
  return (
    <ul className="divide-y divide-ink-100">
      {docs.map((doc) => (
        <li key={doc.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="min-w-0">
            <Link
              href={`/write/${doc.id}`}
              className="font-semibold font-serif text-base text-ink-900 transition-colors hover:text-brand-700"
            >
              {doc.title}
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-500 text-xs">
              {doc.status === 'pending' ? <Badge variant="accent">审校中</Badge> : null}
              <span>{doc.sectionName}</span>
              <time dateTime={lastEditedAt(doc).toISOString()}>
                上次编辑于 {formatDateTime(lastEditedAt(doc))}
              </time>
              {kind === 'published' && hasUncommitted(doc) ? (
                <span className="rounded-full bg-ochre-50 px-2 py-0.5 font-medium text-ochre-800 text-xs">
                  有未提交的修改
                </span>
              ) : null}
              {kind === 'draft' && doc.lastRevisionAt === null ? (
                <span className="text-ink-400">尚未提交过修订</span>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Link
              href={`/write/${doc.id}`}
              className="text-brand-700 transition-colors hover:text-brand-900"
            >
              继续编辑
            </Link>
            {kind === 'published' ? (
              <Link
                href={`/a/${doc.slug}`}
                className="text-ink-500 transition-colors hover:text-brand-700"
              >
                查看文章
              </Link>
            ) : null}
            {/* 仅未发布稿可删（deleteDocument 同样校验） */}
            {doc.status === 'draft' || doc.status === 'pending' ? (
              <DeleteDraftButton docId={doc.id} title={doc.title} />
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function GroupHeading({ title, count, sub }: { title: string; count: number; sub?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span aria-hidden className="h-4 w-1 self-center rounded-xs bg-accent-600" />
      <h2 className="font-semibold font-serif text-ink-900 text-lg">{title}</h2>
      <p className="text-ink-400 text-sm">
        {count} 篇{sub !== undefined ? ` · ${sub}` : ''}
      </p>
    </div>
  );
}

export default async function WritePage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const db = getDb();
  const myDocs = await db
    .select({
      id: documents.id,
      title: documents.title,
      slug: documents.slug,
      status: documents.status,
      updatedAt: documents.updatedAt,
      sectionName: sections.name,
      wcUpdatedAt: workingCopies.updatedAt,
    })
    .from(documents)
    .innerJoin(sections, eq(sections.id, documents.sectionId))
    .leftJoin(
      workingCopies,
      and(eq(workingCopies.documentId, documents.id), eq(workingCopies.userId, session.user.id)),
    )
    .where(eq(documents.ownerId, session.user.id))
    .orderBy(desc(documents.updatedAt));

  // 每篇文档的最新主线修订时刻（建议分支不算「我的草稿」的提交线）
  const docIds = myDocs.map((d) => d.id);
  const lastRevByDoc = new Map<string, Date>();
  if (docIds.length > 0) {
    const revRows = await db
      .select({ documentId: revisions.documentId, last: max(revisions.createdAt) })
      .from(revisions)
      .where(and(inArray(revisions.documentId, docIds), isNull(revisions.suggestionId)))
      .groupBy(revisions.documentId);
    for (const r of revRows) {
      if (r.last !== null) {
        lastRevByDoc.set(r.documentId, r.last);
      }
    }
  }

  const rows: DocRow[] = myDocs.map((d) => ({
    ...d,
    lastRevisionAt: lastRevByDoc.get(d.id) ?? null,
  }));
  const byEdited = (a: DocRow, b: DocRow) => lastEditedAt(b).getTime() - lastEditedAt(a).getTime();
  const drafts = rows.filter((d) => d.status === 'draft' || d.status === 'pending').sort(byEdited);
  const published = rows.filter((d) => d.status === 'published').sort(byEdited);
  const archived = rows.filter((d) => d.status === 'archived').sort(byEdited);
  // 已发布但有未提交修改的，也算「未完成」——在草稿箱里再露出一次
  const publishedUncommitted = published.filter(hasUncommitted);

  // 我提交的、仍在流转中的修订申请
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
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <Breadcrumb items={[{ label: '首页', href: '/' }, { label: '创作中心' }]} />
      <header className="flex flex-wrap items-end justify-between gap-4 border-ink-200 border-b pb-8">
        <div>
          <h1 className="font-semibold font-serif text-2xl text-ink-900">创作中心</h1>
          <p className="mt-2 text-ink-500 text-sm">
            管理草稿、已发布文章与文章系列。写作内容自动保存，申请发布后由志愿者审校上线。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ButtonLink href="/write/series" variant="secondary" className="h-10 px-4">
            <Layers className="h-4 w-4" aria-hidden />
            我的系列
          </ButtonLink>
          <ButtonLink href="/write/new" className="h-10 px-5">
            <PenLine className="h-4 w-4" aria-hidden />
            写文章
          </ButtonLink>
        </div>
      </header>

      <div className="flex flex-col gap-10 py-10">
        {/* 草稿箱：未发布的稿子 + 已发布但有未提交修改的 */}
        <section>
          <GroupHeading
            title="草稿箱"
            count={drafts.length + publishedUncommitted.length}
            sub="未编辑完成的文章"
          />
          {drafts.length > 0 || publishedUncommitted.length > 0 ? (
            <div className="mt-2">
              {drafts.length > 0 ? <DocList docs={drafts} kind="draft" /> : null}
              {publishedUncommitted.length > 0 ? (
                <>
                  <p className="mt-4 border-ink-100 border-t pt-4 text-ink-400 text-xs">
                    已发布、但有改到一半未提交的修改：
                  </p>
                  <DocList docs={publishedUncommitted} kind="published" />
                </>
              ) : null}
            </div>
          ) : (
            <EmptyState
              icon={<PenLine />}
              title="草稿箱是空的"
              description="点右上角「写文章」开始写，内容会自动保存。"
            />
          )}
          {drafts.some((d) => d.status === 'pending') ? (
            <p className="mt-3 text-ink-400 text-xs">
              标着「审校中」的稿子已申请发布，仍可继续编辑（上线前的修改会一并审校）。
            </p>
          ) : null}
        </section>

        {/* 已发布 */}
        <section>
          <GroupHeading title="已发布" count={published.length} />
          {published.length > 0 ? (
            <div className="mt-2">
              <DocList docs={published} kind="published" />
            </div>
          ) : (
            <p className="mt-4 text-ink-400 text-sm">还没有发布的文章。</p>
          )}
        </section>

        {/* 我的修订申请：仍在流转中的 */}
        {mySuggestions.length > 0 ? (
          <section>
            <GroupHeading title="我的修订申请" count={mySuggestions.length} sub="流转中" />
            <ul className="mt-2 divide-y divide-ink-100">
              {mySuggestions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <Link
                    href={`/suggestions/${s.id}`}
                    className="min-w-0 truncate font-medium text-ink-800 transition-colors hover:text-brand-700"
                  >
                    {s.docTitle}
                  </Link>
                  <span className="shrink-0 text-ink-400 text-xs">
                    {sgStatusLabel[s.status] ?? s.status}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* 已归档：折叠收纳 */}
        {archived.length > 0 ? (
          <details className="reveal rounded-md border border-ink-200 border-dashed p-4">
            <summary className="cursor-pointer text-ink-500 text-sm transition-colors hover:text-ink-700">
              已归档（{archived.length}）
            </summary>
            <div className="mt-2">
              <DocList docs={archived} kind="draft" />
            </div>
          </details>
        ) : null}
      </div>
    </div>
  );
}
