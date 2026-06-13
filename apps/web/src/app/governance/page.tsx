// 社区治理公示（事件级，匿名）：处罚 / 举报裁决 / 巡查回退 / 内容删隐，分区陈列。
// 与 /transparency 区分：那里是聚合统计，这里是逐条治理动作。隐私红线：一律不公示当事人身份，
// 只公示动作类型、范围、原因、时间与状态；聚合数字仍见透明度报告。
import { documents, flags, getDb, redactions, revisions, sanctions, sections } from '@harublog/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumb } from '@/components/breadcrumb';
import { FLAG_REASON_LABELS, type FlagReasonCode } from '@/lib/flag-reasons';
import { formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '社区治理公示',
  description:
    '求学路的治理动作逐条公示：处罚、举报裁决、巡查回退、内容删隐（匿名，不含当事人身份）。',
};

// 每区最多展示的条数（避免长页；更早的留档于审计日志）
const LIMIT = 50;

const SANCTION_KIND_LABELS: Record<string, string> = {
  suspend: '封禁（停用账号）',
  silence: '禁言',
  no_suggest: '禁止提交建议 / 修订申请',
  no_edit: '禁止直接编辑',
};

const SUBJECT_LABELS: Record<string, string> = { comment: '评论', document: '文章' };

function sanctionStatus(s: { endsAt: Date | null; revokedAt: Date | null }, now: number): string {
  if (s.revokedAt !== null) {
    return '已撤销';
  }
  if (s.endsAt !== null && s.endsAt.getTime() < now) {
    return '已到期';
  }
  if (s.endsAt !== null) {
    return `生效中 · 至 ${formatDate(s.endsAt)}`;
  }
  return '长期生效';
}

/** 分区标题：竖条 + 衬线（与权限路线图、修订历史同形）。 */
function SectionHead({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span aria-hidden className="h-4 w-1 self-center rounded-xs bg-accent-600" />
      <h2 className="font-medium font-serif text-ink-800 text-lg">{title}</h2>
      {note !== undefined ? <span className="text-ink-400 text-xs">{note}</span> : null}
    </div>
  );
}

function Empty() {
  return <p className="mt-3 text-ink-400 text-sm">暂无记录。</p>;
}

function Pill({ tone, children }: { tone: 'danger' | 'warn' | 'muted'; children: string }) {
  const cls =
    tone === 'danger'
      ? 'bg-accent-50 text-accent-700'
      : tone === 'warn'
        ? 'bg-ochre-50 text-ochre-800'
        : 'bg-paper-200 text-ink-600';
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${cls}`}>{children}</span>;
}

export default async function GovernancePage() {
  const db = getDb();
  const now = Date.now();

  const [sanctionRows, flagRows, rollbackRows, redactionRows] = await Promise.all([
    db
      .select({
        kind: sanctions.kind,
        sectionName: sections.name,
        reason: sanctions.reason,
        startsAt: sanctions.startsAt,
        endsAt: sanctions.endsAt,
        revokedAt: sanctions.revokedAt,
      })
      .from(sanctions)
      .leftJoin(sections, eq(sections.id, sanctions.sectionId))
      .orderBy(desc(sanctions.startsAt))
      .limit(LIMIT),
    db
      .select({
        reasonCode: flags.reasonCode,
        subjectType: flags.subjectType,
        sectionName: sections.name,
        resolvedAt: flags.resolvedAt,
      })
      .from(flags)
      .leftJoin(sections, eq(sections.id, flags.sectionId))
      .where(eq(flags.status, 'upheld'))
      .orderBy(desc(flags.resolvedAt))
      .limit(LIMIT),
    db
      .select({
        title: documents.title,
        slug: documents.slug,
        seq: revisions.seq,
        message: revisions.message,
        createdAt: revisions.createdAt,
      })
      .from(revisions)
      .innerJoin(documents, eq(documents.id, revisions.documentId))
      // 巡查回退：主线 rollback 修订；仅公示已发布文章（可链接、属公开内容）
      .where(
        and(
          eq(revisions.kind, 'rollback'),
          isNull(revisions.suggestionId),
          eq(documents.status, 'published'),
        ),
      )
      .orderBy(desc(revisions.createdAt))
      .limit(LIMIT),
    db
      .select({
        reason: redactions.reason,
        legalBasis: redactions.legalBasis,
        createdAt: redactions.createdAt,
      })
      .from(redactions)
      .orderBy(desc(redactions.createdAt))
      .limit(LIMIT),
  ]);

  const cap = (n: number) => (n >= LIMIT ? `近 ${LIMIT} 条` : `${n} 条`);

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <Breadcrumb items={[{ label: '首页', href: '/' }, { label: '社区治理公示' }]} />

      <header className="border-ink-200 border-b pb-6">
        <h1 className="font-semibold font-serif text-2xl text-ink-900">社区治理公示</h1>
        <p className="mt-3 text-ink-500 text-sm leading-relaxed">
          治理动作逐条公开，接受社区监督。为保护隐私，
          <span className="text-ink-700">一律不公示当事人身份</span>
          ，只列出动作类型、范围、原因、时间与状态。聚合统计见{' '}
          <Link href="/transparency" className="text-brand-700 hover:text-brand-900">
            透明度报告
          </Link>
          ；所有高危操作均留有不可篡改的审计记录。
        </p>
      </header>

      <div className="mt-8 flex flex-col gap-10">
        {/* 处罚 */}
        <section>
          <SectionHead title="处罚记录" note={cap(sanctionRows.length)} />
          {sanctionRows.length > 0 ? (
            <ul className="mt-4 divide-y divide-ink-100">
              {sanctionRows.map((s, i) => (
                <li key={`${s.startsAt.toISOString()}-${i}`} className="flex flex-col gap-1 py-3.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <Pill tone="danger">{SANCTION_KIND_LABELS[s.kind] ?? s.kind}</Pill>
                    <span className="text-ink-600">{s.sectionName ?? '全局'}</span>
                    <span aria-hidden className="text-ink-300">
                      ·
                    </span>
                    <span className="text-ink-500">{sanctionStatus(s, now)}</span>
                    <time
                      dateTime={s.startsAt.toISOString()}
                      className="ml-auto text-ink-400 text-xs"
                    >
                      {formatDate(s.startsAt)} 起
                    </time>
                  </div>
                  {s.reason.length > 0 ? (
                    <p className="text-ink-600 text-sm leading-relaxed">{s.reason}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <Empty />
          )}
        </section>

        {/* 举报裁决 */}
        <section>
          <SectionHead title="举报裁决（已采纳）" note={cap(flagRows.length)} />
          {flagRows.length > 0 ? (
            <ul className="mt-4 divide-y divide-ink-100">
              {flagRows.map((f, i) => (
                <li
                  key={`${f.resolvedAt?.toISOString() ?? i}-${i}`}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 py-3 text-sm"
                >
                  <Pill tone="muted">举报已采纳</Pill>
                  <span className="text-ink-700">
                    {FLAG_REASON_LABELS[f.reasonCode as FlagReasonCode] ?? f.reasonCode}
                  </span>
                  <span aria-hidden className="text-ink-300">
                    ·
                  </span>
                  <span className="text-ink-500">
                    {SUBJECT_LABELS[f.subjectType] ?? f.subjectType}
                  </span>
                  {f.sectionName !== null ? (
                    <>
                      <span aria-hidden className="text-ink-300">
                        ·
                      </span>
                      <span className="text-ink-500">{f.sectionName}</span>
                    </>
                  ) : null}
                  {f.resolvedAt !== null ? (
                    <time
                      dateTime={f.resolvedAt.toISOString()}
                      className="ml-auto text-ink-400 text-xs"
                    >
                      {formatDate(f.resolvedAt)}
                    </time>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <Empty />
          )}
        </section>

        {/* 巡查回退 */}
        <section>
          <SectionHead title="巡查回退" note={cap(rollbackRows.length)} />
          {rollbackRows.length > 0 ? (
            <ul className="mt-4 divide-y divide-ink-100">
              {rollbackRows.map((r, i) => (
                <li key={`${r.slug}-${r.seq}-${i}`} className="flex flex-col gap-1 py-3.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <Pill tone="warn">巡查回退</Pill>
                    <Link
                      href={`/a/${r.slug}`}
                      className="min-w-0 max-w-[60vw] truncate font-medium text-ink-800 hover:text-brand-700"
                    >
                      《{r.title}》
                    </Link>
                    <span className="text-ink-500">第 {r.seq} 号修订</span>
                    <time
                      dateTime={r.createdAt.toISOString()}
                      className="ml-auto text-ink-400 text-xs"
                    >
                      {formatDate(r.createdAt)}
                    </time>
                  </div>
                  {r.message !== null && r.message.length > 0 ? (
                    <p className="text-ink-600 text-sm leading-relaxed">{r.message}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <Empty />
          )}
        </section>

        {/* 内容删隐 */}
        <section>
          <SectionHead title="内容删隐（合规删除）" note={cap(redactionRows.length)} />
          {redactionRows.length > 0 ? (
            <ul className="mt-4 divide-y divide-ink-100">
              {redactionRows.map((r, i) => (
                <li
                  key={`${r.createdAt.toISOString()}-${i}`}
                  className="flex flex-col gap-1 py-3.5"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <Pill tone="danger">内容删隐</Pill>
                    {r.legalBasis !== null && r.legalBasis.length > 0 ? (
                      <span className="text-ink-500">依据：{r.legalBasis}</span>
                    ) : null}
                    <time
                      dateTime={r.createdAt.toISOString()}
                      className="ml-auto text-ink-400 text-xs"
                    >
                      {formatDate(r.createdAt)}
                    </time>
                  </div>
                  <p className="text-ink-600 text-sm leading-relaxed">{r.reason}</p>
                </li>
              ))}
            </ul>
          ) : (
            <Empty />
          )}
        </section>
      </div>

      <p className="mt-10 text-ink-400 text-xs leading-relaxed">
        本页仅展示各类近 {LIMIT} 条记录；更早的留存于审计日志。处罚与删隐的「原因」由处理者填写，
        代表平台一方的说明。对处罚有异议可经设置页或板块版主申诉。
      </p>
    </div>
  );
}
