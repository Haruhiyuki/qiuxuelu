// 独立板块页：列出全部一级板块（按 position），每块附已发布篇数与高频标签。
// 顶部导航「板块」由 /#sections 锚点改指此页。
import { getDb, sections } from '@harublog/db';
import { Badge, EmptyState } from '@harublog/ui';
import { asc, isNull } from 'drizzle-orm';
import { ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumb } from '@/components/breadcrumb';
import { stageLabel } from '@/lib/stage';
import { countSectionPublished, getSectionTags } from '@/server/section-tags';

export const metadata: Metadata = {
  title: '板块',
  description: '按求学阶段分区编纂的全部板块。',
};

export const dynamic = 'force-dynamic';

export default async function SectionsPage() {
  const db = getDb();
  const tops = await db
    .select()
    .from(sections)
    .where(isNull(sections.parentId))
    .orderBy(asc(sections.position));

  // 每块的已发布篇数 + 高频标签（并行；板块数量小）
  const enriched = await Promise.all(
    tops.map(async (s) => {
      const [count, sectionTags] = await Promise.all([
        countSectionPublished(db, s.id),
        getSectionTags(db, s.id),
      ]);
      return { ...s, count, tags: sectionTags.slice(0, 6) };
    }),
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <Breadcrumb items={[{ label: '首页', href: '/' }, { label: '板块' }]} />
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-ink-200 border-b pb-5">
        <span aria-hidden className="h-5 w-1 self-center rounded-xs bg-accent-600" />
        <h1 className="font-semibold font-serif text-3xl text-ink-900">板块</h1>
        <p className="text-ink-400 text-sm">按求学阶段分区编纂 · 共 {enriched.length} 个板块</p>
      </header>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {enriched.map((s) => (
          <Link key={s.id} href={`/s/${s.slug}`} className="group block">
            <article className="flex h-full flex-col rounded-md border border-ink-200 bg-paper-50 p-5 shadow-paper transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-brand-300 group-hover:shadow-lift">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold font-serif text-ink-900 text-lg leading-snug">
                  {s.name}
                </h2>
                <Badge variant="outline">{stageLabel(s.stage)}</Badge>
              </div>
              {s.description !== null ? (
                <p className="mt-2 text-ink-500 text-sm leading-relaxed">{s.description}</p>
              ) : null}
              {s.tags.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {s.tags.map((t) => (
                    <span
                      key={t.name}
                      className="rounded-full bg-paper-200 px-2 py-0.5 text-ink-600 text-xs"
                    >
                      #{t.name}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="mt-4 flex items-center justify-between border-ink-200/70 border-t pt-3">
                <span className="text-ink-400 text-xs">{s.count} 篇已发布</span>
                <span className="flex items-center gap-1 text-brand-700 text-sm opacity-0 transition-opacity group-hover:opacity-100">
                  进入板块
                  <ArrowRight aria-hidden className="h-3.5 w-3.5" />
                </span>
              </div>
            </article>
          </Link>
        ))}
      </div>

      {enriched.length === 0 ? (
        <EmptyState
          title="板块尚未初始化"
          description="请管理员执行数据库种子脚本（pnpm db:seed）创建初始板块。"
        />
      ) : null}
    </div>
  );
}
