// 权限路线图（服务端组件，零 JS）：把信任等级体系画成竖向驿站图——
// 各级解锁的能力对所有访客公示（治理透明），达标进度仅本人可见。
// 能力清单与 @harublog/domain 的 TRUST_CAP_INCREMENTS / can() 语义一一对应；
// 阈值来自 site_settings（不硬编码），等级以 user_trust 物化值为准。
import type { TrustStats, TrustThresholds } from '@harublog/domain';

/** 各级公示文案：名称沿用 domain 引导文案的称谓（成员/贡献者/资深/共建者） */
export const TRUST_LEVEL_NAMES: Record<number, string> = {
  0: '新成员',
  1: '成员',
  2: '贡献者',
  3: '资深贡献者',
  4: '共建者',
};

interface LevelEntry {
  level: number;
  /** 解锁能力（相对上一级的增量） */
  abilities: string[];
  note?: string;
}

const LEVELS: LevelEntry[] = [
  {
    level: 0,
    abilities: [
      '阅读全站内容',
      '创建草稿、发文、文中发布图片（完整编辑能力）',
      '发表评论（AI 秒审，无需排队）',
      '举报不当内容',
    ],
    note: '注册即是',
  },
  {
    level: 1,
    abilities: ['行内批注正文', '对公共页文章提「编辑建议」'],
  },
  {
    level: 2,
    abilities: ['对公共页文章提「修订申请」', '对私有页文章提「编辑建议」'],
  },
  {
    level: 3,
    abilities: ['在公共页直接「修订」他人文章（即时生效 + 进巡查）', '对私有页文章提「修订申请」'],
    note: '按滚动窗口持续考核，跌破阈值会回落',
  },
  {
    level: 4,
    abilities: ['处理公共页的「修订申请」、管理「修订」'],
    note: '仅社区提名 + 人工授予，无自动达标路径',
  },
];

interface Requirement {
  label: string;
  /** count=计数下限；ratioMax=比例上限；ratioMin=比例下限 */
  kind: 'count' | 'ratioMax' | 'ratioMin';
  actual: number;
  required: number;
}

const met = (r: Requirement): boolean =>
  r.kind === 'count'
    ? r.actual >= r.required
    : r.kind === 'ratioMax'
      ? r.actual <= r.required
      : r.actual >= r.required;

/** 指向 targetLevel 的达标条件（targetLevel ∈ 1|2|3；TL4 无自动路径） */
function requirementsFor(
  targetLevel: number,
  stats: TrustStats,
  t: TrustThresholds,
): Requirement[] {
  switch (targetLevel) {
    case 1:
      return [
        {
          label: '注册天数',
          kind: 'count',
          actual: stats.accountAgeDays,
          required: t.tl1.accountAgeDays,
        },
        {
          label: '累计活跃天数',
          kind: 'count',
          actual: stats.activeDays,
          required: t.tl1.activeDays,
        },
      ];
    case 2:
      return [
        {
          label: '累计活跃天数',
          kind: 'count',
          actual: stats.activeDays,
          required: t.tl2.activeDays,
        },
        {
          label: '发表评论',
          kind: 'count',
          actual: stats.commentsPosted,
          required: t.tl2.commentsPosted,
        },
      ];
    case 3: {
      const w = stats.window;
      const days = t.windowDays;
      return [
        {
          label: `近 ${days} 天建议合入`,
          kind: 'count',
          actual: w.suggestionsMerged,
          required: t.tl3.suggestionsMerged,
        },
        {
          label: '建议被拒比例',
          kind: 'ratioMax',
          actual: w.mergeRejectRatio,
          required: t.tl3.maxMergeRejectRatio,
        },
        {
          label: '举报命中率',
          kind: 'ratioMin',
          actual: w.flagsAccuracy,
          required: t.tl3.minFlagsAccuracy,
        },
        {
          label: `近 ${days} 天活跃天数`,
          kind: 'count',
          actual: w.activeDays,
          required: t.tl3.activeDays,
        },
      ];
    }
    default:
      return [];
  }
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;

function RequirementRow({ r }: { r: Requirement }) {
  const ok = met(r);
  const valueText =
    r.kind === 'count'
      ? `${r.actual} / ${r.required}`
      : r.kind === 'ratioMax'
        ? `${pct(r.actual)}（需 ≤ ${pct(r.required)}）`
        : `${pct(r.actual)}（需 ≥ ${pct(r.required)}）`;
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="flex items-center gap-1.5 text-ink-600">
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-moss-600' : 'bg-ochre-600'}`}
          />
          {r.label}
        </span>
        <span className={`tabular-nums ${ok ? 'text-moss-700' : 'text-ink-500'}`}>
          {valueText}
          {ok ? ' ✓' : ''}
        </span>
      </div>
      {r.kind === 'count' ? (
        <div className="mt-1 ml-3 h-1 overflow-hidden rounded-full bg-ink-100" aria-hidden>
          <div
            className={`h-full rounded-full ${ok ? 'bg-moss-600' : 'bg-brand-500'}`}
            style={{ width: `${Math.min(100, (r.actual / Math.max(1, r.required)) * 100)}%` }}
          />
        </div>
      ) : null}
    </li>
  );
}

export function TrustRoadmap({
  currentLevel,
  progress,
}: {
  currentLevel: number;
  /** 本人查看时提供：实时统计 + 站点阈值；仅本人页展示 */
  progress: { stats: TrustStats; thresholds: TrustThresholds } | null;
}) {
  // 下一级晋升目标（≤TL3 有自动路径）；处于 TL3 时额外看保级
  const promoteTo = currentLevel + 1;
  const showPromote = progress !== null && promoteTo <= 3;
  const showRetention = progress !== null && currentLevel === 3;
  const reqs =
    progress === null
      ? []
      : showPromote
        ? requirementsFor(promoteTo, progress.stats, progress.thresholds)
        : showRetention
          ? requirementsFor(3, progress.stats, progress.thresholds)
          : [];
  const allMet = reqs.length > 0 && reqs.every(met);

  return (
    <section aria-label="权限路线图">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span aria-hidden className="h-4 w-1 self-center rounded-xs bg-accent-600" />
        <h2 className="font-medium font-serif text-ink-800 text-lg">权限路线图</h2>
        <p className="text-ink-400 text-xs">晋升给能力，任命给权力——治理职务不在此列</p>
      </div>

      {/* 升级路径：横向卡片，逐级解锁；当前级高亮，已过级打勾 */}
      <div className="-mx-1 mt-5 flex gap-3 overflow-x-auto px-1 pb-2">
        {LEVELS.map((entry) => {
          const isCurrent = entry.level === currentLevel;
          const isPassed = entry.level < currentLevel;
          return (
            <div
              key={entry.level}
              className={`flex w-56 shrink-0 flex-col rounded-lg border p-4 transition-colors ${
                isCurrent
                  ? 'border-accent-500 bg-accent-50/40 shadow-paper'
                  : isPassed
                    ? 'border-brand-200 bg-paper-50'
                    : 'border-ink-200 border-dashed bg-paper-50'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xs font-serif text-sm leading-none ${
                    isCurrent
                      ? 'bg-accent-600 text-on-fill'
                      : isPassed
                        ? 'bg-brand-600 text-on-fill'
                        : 'border border-ink-300 bg-paper-50 text-ink-400'
                  }`}
                >
                  {isPassed ? '✓' : entry.level}
                </span>
                <span
                  className={`font-medium font-serif text-sm ${
                    entry.level > currentLevel ? 'text-ink-500' : 'text-ink-900'
                  }`}
                >
                  TL{entry.level} · {TRUST_LEVEL_NAMES[entry.level]}
                </span>
              </div>
              {isCurrent ? (
                <span className="mt-2 inline-flex w-fit rounded-full bg-accent-50 px-2 py-0.5 font-medium text-accent-700 text-xs">
                  当前
                </span>
              ) : entry.note !== undefined ? (
                <span className="mt-2 text-ink-400 text-xs">{entry.note}</span>
              ) : null}
              <ul
                className={`mt-2.5 flex flex-col gap-1 text-xs leading-relaxed ${
                  entry.level > currentLevel ? 'text-ink-400' : 'text-ink-600'
                }`}
              >
                {entry.abilities.map((a) => (
                  <li key={a} className="flex gap-1.5">
                    <span aria-hidden className="text-ink-300">
                      {entry.level <= currentLevel ? '＋' : '·'}
                    </span>
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* 晋升进度 / 保级（仅本人可见） */}
      {progress !== null && (showPromote || showRetention) ? (
        <div className="mt-4 rounded-md border border-ink-200 bg-paper-50 p-4 shadow-paper">
          <p className="font-medium text-ink-700 text-sm">
            {showPromote
              ? `晋升到 TL${promoteTo} · ${TRUST_LEVEL_NAMES[promoteTo]}`
              : '保级状态（滚动窗口考核）'}
            {showPromote && allMet ? (
              <span className="ml-2 text-moss-700 text-xs">已达标，下次活动结算时自动晋升</span>
            ) : null}
            {showRetention && !allMet ? (
              <span className="ml-2 text-ochre-700 text-xs">有指标跌破阈值，结算时可能回落</span>
            ) : null}
          </p>
          <ul className="mt-3 flex flex-col gap-2.5">
            {reqs.map((r) => (
              <RequirementRow key={r.label} r={r} />
            ))}
          </ul>
        </div>
      ) : null}
      {progress !== null && currentLevel >= 3 ? (
        <p className="mt-3 text-ink-400 text-xs leading-relaxed">
          TL4 由社区提名并人工授予——持续的高质量贡献会被看见。
        </p>
      ) : null}

      <p className="mt-6 text-ink-400 text-xs">
        阈值由站点治理配置并随社区规模调整；治理职务（编辑、板块版主等）由任命授予，不经此路线。协作权（公共页
        / 私有页两条线）见
        <a href="/covenant" className="ml-1 text-brand-700 hover:text-brand-900">
          社区公约
        </a>
        。
      </p>
    </section>
  );
}
