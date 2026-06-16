// 公开透明度报告（架构 §9 M5）：只出聚合数据，不含任何个人信息。治理可被监督是公益项目的底色。
import {
  auditLog,
  comments,
  documents,
  flags,
  getDb,
  revisions,
  sanctions,
  suggestions,
  user as userTable,
} from '@harublog/db';
import { countDistinct, eq, isNull, sql } from 'drizzle-orm';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '透明度报告',
  description: '求学路平台的内容规模与社区治理聚合数据（仅统计，不含个人信息）。',
};

async function scalar(promise: Promise<{ n: number }[]>): Promise<number> {
  const rows = await promise;
  return Number(rows[0]?.n ?? 0);
}

function pct(part: number, whole: number): string {
  return whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`;
}

export default async function TransparencyPage() {
  const db = getDb();
  const cnt = sql<number>`count(*)`;

  const [
    publishedDocs,
    totalUsers,
    contributors,
    mainlineRevisions,
    sgMerged,
    sgRejected,
    flagsUpheld,
    flagsDismissed,
    activeSanctions,
    visibleComments,
    auditTotal,
  ] = await Promise.all([
    scalar(db.select({ n: cnt }).from(documents).where(eq(documents.status, 'published'))),
    scalar(db.select({ n: cnt }).from(userTable)),
    scalar(
      db
        .select({ n: countDistinct(revisions.authorId) })
        .from(revisions)
        .where(isNull(revisions.suggestionId)),
    ),
    scalar(db.select({ n: cnt }).from(revisions).where(isNull(revisions.suggestionId))),
    scalar(db.select({ n: cnt }).from(suggestions).where(eq(suggestions.status, 'merged'))),
    scalar(db.select({ n: cnt }).from(suggestions).where(eq(suggestions.status, 'rejected'))),
    scalar(db.select({ n: cnt }).from(flags).where(eq(flags.status, 'upheld'))),
    scalar(db.select({ n: cnt }).from(flags).where(eq(flags.status, 'dismissed'))),
    scalar(db.select({ n: cnt }).from(sanctions).where(isNull(sanctions.revokedAt))),
    scalar(db.select({ n: cnt }).from(comments).where(eq(comments.status, 'visible'))),
    scalar(db.select({ n: cnt }).from(auditLog)),
  ]);

  const sgDecided = sgMerged + sgRejected;
  const flagsResolved = flagsUpheld + flagsDismissed;

  const groups: { title: string; stats: { label: string; value: string }[] }[] = [
    {
      title: '内容规模',
      stats: [
        { label: '已发布文章', value: String(publishedDocs) },
        { label: '主线修订数', value: String(mainlineRevisions) },
        { label: '贡献者', value: String(contributors) },
        { label: '注册用户', value: String(totalUsers) },
        { label: '可见评论', value: String(visibleComments) },
      ],
    },
    {
      title: '协作与审校',
      stats: [
        { label: '建议被采纳', value: String(sgMerged) },
        { label: '建议被驳回', value: String(sgRejected) },
        { label: '建议采纳率', value: pct(sgMerged, sgDecided) },
      ],
    },
    {
      title: '社区治理',
      stats: [
        { label: '举报已采纳', value: String(flagsUpheld) },
        { label: '举报已驳回', value: String(flagsDismissed) },
        { label: '举报采纳率', value: pct(flagsUpheld, flagsResolved) },
        { label: '生效中的制裁', value: String(activeSanctions) },
        { label: '审计事件总数', value: String(auditTotal) },
      ],
    },
  ];

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <header className="border-ink-200 border-b pb-6">
        <h1 className="font-semibold font-serif text-3xl text-ink-900">透明度报告</h1>
        <p className="mt-3 text-ink-500 text-sm leading-relaxed">
          求学路是非营利公益项目。我们公开内容规模与治理活动的聚合统计，接受社区监督。
          本页只含统计数字，不含任何用户个人信息。
        </p>
      </header>

      <div className="mt-8 flex flex-col gap-8">
        {groups.map((g) => (
          <section key={g.title}>
            <h2 className="font-medium font-serif text-ink-800 text-lg">{g.title}</h2>
            <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
              {g.stats.map((s) => (
                <div key={s.label} className="rounded-sm border border-ink-200 bg-paper-50 p-4">
                  <dt className="text-ink-500 text-sm">{s.label}</dt>
                  <dd className="mt-1 font-semibold font-serif text-2xl text-ink-900">{s.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>

      <p className="mt-10 text-ink-400 text-xs">
        内容默认以 CC BY-NC-SA 4.0 共享，全站内容可经 /api/export
        导出。治理高危操作均留有不可篡改的审计记录。
      </p>
    </div>
  );
}
