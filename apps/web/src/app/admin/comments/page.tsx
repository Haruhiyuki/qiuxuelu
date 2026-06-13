// AI 评论复核队列：列出被 DeepSeek 拦下（status='ai_held'）的评论，管理员可放行误判或删除。
import { comments, documents, getDb, user as userTable } from '@harublog/db';
import { Badge, EmptyState } from '@harublog/ui';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { ShieldAlert } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { HeldCommentActions } from '@/components/held-comment-actions';
import { formatDateTime } from '@/lib/format';
import { getSession } from '@/lib/session';
import { loadActor, sectionScopeForCapability } from '@/server/actors';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'AI 评论复核', robots: { index: false } };

// AI 拦截类别 → 中文标签
const CATEGORY_LABELS: Record<string, string> = {
  spam: '广告/垃圾',
  harassment: '攻击/骚扰',
  hate: '仇恨/歧视',
  illegal: '违法',
  sexual: '色情',
  privacy: '隐私',
  none: '其他',
};

function Forbidden() {
  return (
    <div className="mx-auto w-full max-w-xl px-6 py-20 text-center">
      <h1 className="font-serif text-2xl text-ink-900">无权访问</h1>
      <p className="mt-3 text-ink-500 text-sm">评论复核需要板块版主及以上角色。</p>
      <p className="mt-6 text-sm">
        <Link href="/" className="text-brand-700 hover:text-brand-900">
          ← 返回首页
        </Link>
      </p>
    </div>
  );
}

export default async function HeldCommentsPage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  const actor = await loadActor(session.user.id);
  if (actor === null) {
    return <Forbidden />;
  }
  const scope = sectionScopeForCapability(actor, 'comment.moderate');
  if (scope !== 'all' && scope.length === 0) {
    return <Forbidden />;
  }

  const db = getDb();
  const where =
    scope === 'all'
      ? eq(comments.status, 'ai_held')
      : and(eq(comments.status, 'ai_held'), inArray(documents.sectionId, scope));
  const items = await db
    .select({
      id: comments.id,
      kind: comments.kind,
      body: comments.body,
      category: comments.aiCategory,
      reason: comments.aiReason,
      model: comments.aiModel,
      createdAt: comments.createdAt,
      slug: documents.slug,
      title: documents.title,
      authorName: userTable.name,
    })
    .from(comments)
    .innerJoin(documents, eq(documents.id, comments.documentId))
    .leftJoin(userTable, eq(userTable.id, comments.authorId))
    .where(where)
    .orderBy(desc(comments.createdAt))
    .limit(100);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="flex items-baseline gap-3">
        <ShieldAlert className="h-5 w-5 self-center text-accent-600" aria-hidden />
        <h1 className="font-semibold font-serif text-2xl text-ink-900">AI 评论复核</h1>
        <p className="text-ink-400 text-sm">DeepSeek 拦下、待人工复核的评论</p>
      </div>
      <p className="mt-2 text-ink-500 text-sm">
        放行误判的评论使其公开显示；确认违规则删除。AI 秒审、宁放勿误伤，落到这里的多为边界情况。
      </p>

      {items.length === 0 ? (
        <div className="mt-8">
          <EmptyState title="队列是空的" description="当前没有被 AI 拦下、等待复核的评论。" />
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-4">
          {items.map((c) => {
            const text =
              typeof (c.body as { text?: unknown })?.text === 'string'
                ? (c.body as { text: string }).text
                : '（无法显示内容）';
            return (
              <li
                key={c.id}
                className="rounded-md border border-ink-200 bg-paper-50 p-4 shadow-paper"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-400 text-xs">
                  <Badge variant="accent">{CATEGORY_LABELS[c.category ?? 'none'] ?? '其他'}</Badge>
                  {c.kind === 'inline' ? <Badge variant="outline">行内</Badge> : null}
                  <span className="font-medium text-ink-600">{c.authorName ?? '佚名'}</span>
                  <span aria-hidden>·</span>
                  <Link href={`/a/${c.slug}`} className="truncate hover:text-brand-700">
                    {c.title}
                  </Link>
                  <span aria-hidden>·</span>
                  <span>{formatDateTime(c.createdAt)}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-ink-800 text-sm leading-relaxed">
                  {text}
                </p>
                {c.reason !== null && c.reason.length > 0 ? (
                  <p className="mt-2 text-ink-400 text-xs">AI 理由：{c.reason}</p>
                ) : null}
                <div className="mt-3 border-ink-200/70 border-t pt-3">
                  <HeldCommentActions commentId={c.id} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
