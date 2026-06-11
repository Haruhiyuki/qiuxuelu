// 贡献者公开主页：身份 + 信任等级 + 贡献统计 + 已发布文章。内容溯源与作者信象（架构 §4）。
import {
  documents,
  getDb,
  revisions,
  sections,
  suggestions,
  user as userTable,
  userTrust,
} from '@harublog/db';
import { Badge, EmptyState } from '@harublog/ui';
import { and, count, countDistinct, desc, eq, isNull } from 'drizzle-orm';
import { PenLine } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Breadcrumb } from '@/components/breadcrumb';
import { formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface ProfilePageProps {
  params: Promise<{ id: string }>;
}

const TRUST_LABEL: Record<number, string> = {
  0: '新成员',
  1: '已注册',
  2: '活跃贡献者',
  3: '资深贡献者',
  4: '核心贡献者',
};

async function loadProfile(id: string) {
  const db = getDb();
  const rows = await db
    .select({
      id: userTable.id,
      name: userTable.name,
      image: userTable.image,
      bio: userTable.bio,
      educationStage: userTable.educationStage,
      createdAt: userTable.createdAt,
      trustLevel: userTrust.level,
    })
    .from(userTable)
    .leftJoin(userTrust, eq(userTrust.userId, userTable.id))
    .where(eq(userTable.id, id))
    .limit(1);
  return rows[0];
}

export async function generateMetadata({ params }: ProfilePageProps): Promise<Metadata> {
  const { id } = await params;
  const profile = await loadProfile(id);
  if (!profile) {
    return { title: '用户不存在' };
  }
  return {
    title: `${profile.name} 的主页`,
    description: `${profile.name} 在求学路的公开贡献与文章。`,
  };
}

export default async function ProfilePage({ params }: ProfilePageProps) {
  const { id } = await params;
  const profile = await loadProfile(id);
  if (!profile) {
    notFound();
  }

  const db = getDb();
  const [docs, mergedRows, revisionRows] = await Promise.all([
    db
      .select({
        slug: documents.slug,
        title: documents.title,
        summary: documents.summary,
        updatedAt: documents.updatedAt,
        sectionName: sections.name,
      })
      .from(documents)
      .innerJoin(sections, eq(sections.id, documents.sectionId))
      .where(and(eq(documents.ownerId, profile.id), eq(documents.status, 'published')))
      .orderBy(desc(documents.updatedAt)),
    db
      .select({ n: count() })
      .from(suggestions)
      .where(and(eq(suggestions.authorId, profile.id), eq(suggestions.status, 'merged'))),
    db
      .select({ n: countDistinct(revisions.id) })
      .from(revisions)
      .where(and(eq(revisions.authorId, profile.id), isNull(revisions.suggestionId))),
  ]);

  const trustLevel = profile.trustLevel ?? 0;
  const mergedCount = Number(mergedRows[0]?.n ?? 0);
  const stats = [
    { label: '已发布文章', value: docs.length },
    { label: '修订贡献', value: Number(revisionRows[0]?.n ?? 0) },
    { label: '被采纳建议', value: mergedCount },
  ];

  // 成就徽章：由信任等级与贡献里程碑派生（无需独立表）
  const badges: string[] = [];
  if (trustLevel >= 4) {
    badges.push('🏛 核心共建者');
  }
  if (docs.length >= 5) {
    badges.push('✍ 高产作者');
  } else if (docs.length >= 1) {
    badges.push('📄 已发布作者');
  }
  if (mergedCount >= 10) {
    badges.push('🥇 金牌建议者');
  } else if (mergedCount >= 1) {
    badges.push('💡 建议被采纳');
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <Breadcrumb items={[{ label: '首页', href: '/' }, { label: profile.name }]} />
      <header className="flex items-start gap-4 border-ink-200 border-b pb-6">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-100 font-semibold font-serif text-2xl text-brand-700">
          {profile.image ? (
            <img src={profile.image} alt={profile.name} className="h-full w-full object-cover" />
          ) : (
            profile.name.slice(0, 1)
          )}
        </div>
        <div className="min-w-0">
          <h1 className="font-semibold font-serif text-2xl text-ink-900">{profile.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-500 text-sm">
            <Badge variant="brand">
              TL{trustLevel} · {TRUST_LABEL[trustLevel] ?? '贡献者'}
            </Badge>
            {profile.educationStage ? (
              <Badge variant="outline">{profile.educationStage}</Badge>
            ) : null}
            <span>加入于 {formatDate(profile.createdAt)}</span>
          </div>
          {profile.bio ? (
            <p className="mt-2 text-ink-600 text-sm leading-relaxed">{profile.bio}</p>
          ) : null}
          {badges.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {badges.map((b) => (
                <span
                  key={b}
                  className="rounded-sm bg-paper-200 px-2 py-0.5 text-ink-600 text-xs"
                  title="成就徽章"
                >
                  {b}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      <dl className="mt-6 grid grid-cols-3 gap-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-sm border border-ink-200 bg-paper-50 p-4 text-center"
          >
            <dd className="font-semibold font-serif text-2xl text-ink-900">{s.value}</dd>
            <dt className="mt-1 text-ink-500 text-xs">{s.label}</dt>
          </div>
        ))}
      </dl>

      <section className="mt-8">
        <h2 className="font-medium font-serif text-ink-800 text-lg">已发布文章</h2>
        {docs.length > 0 ? (
          <ul className="mt-3 divide-y divide-ink-100">
            {docs.map((doc) => (
              <li key={doc.slug} className="py-4">
                <Link
                  href={`/a/${doc.slug}`}
                  className="font-medium font-serif text-ink-900 hover:text-brand-700"
                >
                  {doc.title}
                </Link>
                {doc.summary ? <p className="mt-1 text-ink-500 text-sm">{doc.summary}</p> : null}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 text-ink-400 text-xs">
                  <span>{doc.sectionName}</span>
                  <time dateTime={doc.updatedAt.toISOString()}>
                    更新于 {formatDate(doc.updatedAt)}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<PenLine />}
            title="还没有公开文章"
            description="这位贡献者尚未发布文章——也许正在共建他人的篇章。"
          />
        )}
      </section>
    </div>
  );
}
