// 贡献者公开主页：身份 + 信任等级 + 贡献统计 + 已发布文章。内容溯源与作者信象（架构 §4）。
import {
  documents,
  getDb,
  revisions,
  roleGrants,
  sections,
  suggestions,
  user as userTable,
  userTrust,
} from '@harublog/db';
import { Badge, EmptyState } from '@harublog/ui';
import { and, count, countDistinct, desc, eq, isNull } from 'drizzle-orm';
import {
  Award,
  CalendarDays,
  ChevronRight,
  Feather,
  FileText,
  GraduationCap,
  Landmark,
  Layers,
  Lightbulb,
  PenLine,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { Breadcrumb } from '@/components/breadcrumb';
import { TRUST_LEVEL_NAMES, TrustRoadmap } from '@/components/trust-roadmap';
import { formatDate } from '@/lib/format';
import { ROLE_LABELS, type StaffRole } from '@/lib/roles';
import { getSession } from '@/lib/session';
import { listUserSeries } from '@/server/series';
import { computeUserStats, loadThresholds } from '@/server/trust';

export const dynamic = 'force-dynamic';

interface ProfilePageProps {
  params: Promise<{ id: string }>;
}

async function loadProfile(id: string) {
  const db = getDb();
  const rows = await db
    .select({
      id: userTable.id,
      name: userTable.name,
      image: userTable.image,
      bio: userTable.bio,
      educationStage: userTable.educationStage,
      education: userTable.education,
      createdAt: userTable.createdAt,
      trustLevel: userTrust.level,
    })
    .from(userTable)
    .leftJoin(userTrust, eq(userTrust.userId, userTable.id))
    .where(eq(userTable.id, id))
    .limit(1);
  const profile = rows[0];
  if (profile === undefined) {
    return undefined;
  }
  // 在任职务（未撤销）：取最高一个，个人卡片显示职务而非贡献等级
  const grants = await db
    .select({ role: roleGrants.role })
    .from(roleGrants)
    .where(and(eq(roleGrants.userId, id), isNull(roleGrants.revokedAt)));
  const held = new Set(grants.map((g) => g.role));
  const RANK: StaffRole[] = ['superadmin', 'admin', 'section_mod', 'editor'];
  const topRole = RANK.find((r) => held.has(r)) ?? null;
  return { ...profile, topRole };
}

export async function generateMetadata({ params }: ProfilePageProps): Promise<Metadata> {
  const { id } = await params;
  const profile = await loadProfile(id);
  if (!profile) {
    // notFound() 在 Next 16 会软返回 200（框架限制）；至少标 noindex，避免「不存在」页被收录
    return { title: '用户不存在', robots: { index: false } };
  }
  return {
    title: `${profile.name} 的主页`,
    description: `${profile.name} 在求学路的公开贡献与文章。`,
  };
}

// 成就荣誉胶囊：暖金（ochre）色系，区别于品牌色的操作入口；与正文/文章页的胶囊语言同形不同色。
function HonorChip({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-ochre-200 bg-ochre-50 px-2.5 py-0.5 text-ochre-800 text-xs"
      title="贡献成就"
    >
      {icon}
      {label}
    </span>
  );
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

  // 路线图的达标进度仅本人可见：访客只看路线与当前位置，不见统计数字
  const session = await getSession();
  const isOwnProfile = session?.user.id === profile.id;
  // 文章系列：访客只见有已发布条目的系列，本人见全部
  const userSeries = await listUserSeries(profile.id, { onlyWithPublished: !isOwnProfile });
  let roadmapProgress: Parameters<typeof TrustRoadmap>[0]['progress'] = null;
  if (isOwnProfile) {
    const thresholds = await loadThresholds(db);
    const stats = await computeUserStats(
      db,
      profile.id,
      profile.createdAt,
      new Date(),
      thresholds.windowDays,
    );
    roadmapProgress = { stats, thresholds };
  }

  const mergedCount = Number(mergedRows[0]?.n ?? 0);
  const stats = [
    { label: '已发布文章', value: docs.length },
    { label: '修订贡献', value: Number(revisionRows[0]?.n ?? 0) },
    { label: '被采纳建议', value: mergedCount },
  ];

  // 成就荣誉：由信任等级与贡献里程碑派生（无需独立表），统一图标胶囊呈现
  const honorIcon = 'h-3.5 w-3.5';
  const honors: { icon: ReactNode; label: string }[] = [];
  if (trustLevel >= 4) {
    honors.push({ icon: <Landmark className={honorIcon} aria-hidden />, label: '核心共建者' });
  }
  if (docs.length >= 5) {
    honors.push({ icon: <Feather className={honorIcon} aria-hidden />, label: '高产作者' });
  } else if (docs.length >= 1) {
    honors.push({ icon: <FileText className={honorIcon} aria-hidden />, label: '已发布作者' });
  }
  if (mergedCount >= 10) {
    honors.push({ icon: <Award className={honorIcon} aria-hidden />, label: '金牌建议者' });
  } else if (mergedCount >= 1) {
    honors.push({ icon: <Lightbulb className={honorIcon} aria-hidden />, label: '建议被采纳' });
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <Breadcrumb items={[{ label: '首页', href: '/' }, { label: profile.name }]} />

      {/* 身份名帖：头像 + 名号/信任/加入 紧凑成行；简介、教育经历、成就整卡宽逐块铺开（长内容与移动端友好） */}
      <div className="mt-4 rounded-lg border border-ink-200 bg-paper-50 p-5 shadow-paper sm:p-6">
        <div className="flex items-start gap-4 sm:gap-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-100 font-semibold font-serif text-2xl text-brand-700 ring-1 ring-ink-200 sm:h-20 sm:w-20 sm:text-3xl">
            {profile.image ? (
              <img src={profile.image} alt={profile.name} className="h-full w-full object-cover" />
            ) : (
              profile.name.slice(0, 1)
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="truncate font-semibold font-serif text-ink-900 text-xl sm:text-2xl">
                  {profile.name}
                </h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-ink-400 text-xs">
                  {/* 有任命职务者显示职务（任命授权力），否则显示贡献等级（晋升授能力） */}
                  {profile.topRole !== null ? (
                    <Badge variant="accent" title="治理职务（任命授予）">
                      {ROLE_LABELS[profile.topRole]}
                    </Badge>
                  ) : (
                    <Badge variant="brand">
                      TL{trustLevel} · {TRUST_LEVEL_NAMES[trustLevel] ?? '贡献者'}
                    </Badge>
                  )}
                  <span className="flex items-center gap-1">
                    <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                    加入于 {formatDate(profile.createdAt)}
                  </span>
                </div>
              </div>
              {isOwnProfile ? (
                <Link
                  href="/account#profile"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-ink-200 px-3 py-1 text-ink-600 text-xs transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                >
                  <PenLine className="h-3.5 w-3.5" aria-hidden />
                  <span className="hidden sm:inline">编辑资料</span>
                  <span className="sm:hidden">编辑</span>
                </Link>
              ) : null}
            </div>
          </div>
        </div>

        {/* 简介：整卡宽，长文可读（保留用户换行） */}
        {profile.bio ? (
          <p className="mt-4 whitespace-pre-line text-ink-600 text-sm leading-relaxed">
            {profile.bio}
          </p>
        ) : null}

        {/* 教育经历：多条各占一行，阶段做小标签，长校名/专业自动截断不挤压 */}
        {profile.education && profile.education.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-2">
            {profile.education.map((e, i) => (
              <li key={i} className="flex items-center gap-2 text-ink-600 text-sm">
                <GraduationCap className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
                <span className="shrink-0 rounded-full bg-paper-200 px-2 py-0.5 text-ink-600 text-xs">
                  {e.stage}
                </span>
                <span className="min-w-0 truncate">
                  {e.school}
                  {e.field ? <span className="text-ink-400"> · {e.field}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : profile.educationStage ? (
          <p className="mt-4 flex items-center gap-2 text-ink-600 text-sm">
            <GraduationCap className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
            {profile.educationStage}
          </p>
        ) : null}

        {/* 成就 */}
        {honors.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {honors.map((h) => (
              <HonorChip key={h.label} icon={h.icon} label={h.label} />
            ))}
          </div>
        ) : null}

        {/* 贡献概览：与身份同卡，分隔线下三栏等宽 */}
        <dl className="mt-5 grid grid-cols-3 divide-x divide-ink-200/70 border-ink-200/70 border-t pt-4">
          {stats.map((s) => (
            <div key={s.label} className="px-2 text-center">
              <dd className="font-semibold font-serif text-2xl text-ink-900 tabular-nums">
                {s.value}
              </dd>
              <dt className="mt-0.5 text-ink-500 text-xs">{s.label}</dt>
            </div>
          ))}
        </dl>
      </div>

      {/* 已发布文章：贡献者的主要产出，紧随身份卡 */}
      <section className="mt-10">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span aria-hidden className="h-4 w-1 self-center rounded-xs bg-accent-600" />
          <h2 className="font-medium font-serif text-ink-800 text-lg">已发布文章</h2>
          {docs.length > 0 ? (
            <span className="text-ink-400 text-xs tabular-nums">共 {docs.length} 篇</span>
          ) : null}
        </div>
        {docs.length > 0 ? (
          <ul className="mt-4 divide-y divide-ink-100">
            {docs.map((doc) => (
              <li key={doc.slug} className="py-4">
                <Link
                  href={`/a/${doc.slug}`}
                  className="font-medium font-serif text-ink-900 transition-colors hover:text-brand-700"
                >
                  {doc.title}
                </Link>
                {doc.summary ? (
                  <p className="mt-1 line-clamp-2 text-ink-500 text-sm leading-relaxed">
                    {doc.summary}
                  </p>
                ) : null}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 text-ink-400 text-xs">
                  <span className="rounded-full bg-paper-200 px-2 py-0.5">{doc.sectionName}</span>
                  <time dateTime={doc.updatedAt.toISOString()}>
                    更新于 {formatDate(doc.updatedAt)}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-4">
            <EmptyState
              icon={<PenLine />}
              title="还没有公开文章"
              description="这位贡献者尚未发布文章——也许正在共建他人的篇章。"
            />
          </div>
        )}
      </section>

      {/* 文章系列：作者编排的有序合集 */}
      {userSeries.length > 0 ? (
        <section className="mt-10">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span aria-hidden className="h-4 w-1 self-center rounded-xs bg-brand-500" />
            <h2 className="font-medium font-serif text-ink-800 text-lg">文章系列</h2>
            <span className="text-ink-400 text-xs tabular-nums">共 {userSeries.length} 个</span>
            {isOwnProfile ? (
              <Link
                href="/write/series"
                className="ml-auto text-brand-700 text-sm transition-colors hover:text-brand-900"
              >
                管理系列 →
              </Link>
            ) : null}
          </div>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {userSeries.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/series/${s.slug}`}
                  className="group flex h-full items-start gap-3 rounded-xl border border-ink-100 p-4 transition-colors hover:border-brand-200 hover:bg-paper-50"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-on-fill">
                    <Layers className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 font-medium font-serif text-ink-900 transition-colors group-hover:text-brand-700">
                      <span className="truncate">{s.title}</span>
                      <ChevronRight
                        className="h-4 w-4 shrink-0 text-ink-300 transition-colors group-hover:text-brand-500"
                        aria-hidden
                      />
                    </span>
                    {s.description ? (
                      <span className="mt-0.5 line-clamp-1 block text-ink-500 text-sm">
                        {s.description}
                      </span>
                    ) : null}
                    <span className="mt-1 block text-ink-400 text-xs tabular-nums">
                      {s.published} 篇已发布
                      {isOwnProfile && s.total > s.published
                        ? ` · ${s.total - s.published} 篇草稿`
                        : ''}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 权限路线图：仅本人主页可见（自己的升级路径与进度），不对外公示 */}
      {isOwnProfile ? (
        <div className="mt-12 border-ink-200 border-t pt-8">
          <TrustRoadmap currentLevel={trustLevel} progress={roadmapProgress} />
        </div>
      ) : null}
    </div>
  );
}
