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
      '创建草稿并提交发布（经审校）',
      '发表评论（首帖预审、限速）',
      '举报不当内容',
    ],
    note: '注册即是',
  },
  {
    level: 1,
    abilities: ['评论免预审', '行内批注正文', '上传图片'],
  },
  {
    level: 2,
    abilities: ['对他人文章提交编辑建议'],
  },
  {
    level: 3,
    abilities: ['在公共页直接编辑他人文章（即时生效 + 进巡查）'],
    note: '按滚动窗口持续考核，跌破阈值会回落',
  },
  {
    level: 4,
    abilities: ['审定他人文章的编辑建议'],
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
  /** 本人查看时提供：实时统计 + 站点阈值；访客为 null（只看路线，不见数字） */
  progress: { stats: TrustStats; thresholds: TrustThresholds } | null;
}) {
  return (
    <section aria-label="权限路线图">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span aria-hidden className="h-4 w-1 self-center rounded-xs bg-accent-600" />
        <h2 className="font-medium font-serif text-ink-800 text-lg">权限路线图</h2>
        <p className="text-ink-400 text-xs">晋升给能力，任命给权力——治理职务不在此列</p>
      </div>

      <ol className="mt-5 flex flex-col">
        {LEVELS.map((entry, i) => {
          const isCurrent = entry.level === currentLevel;
          const isPassed = entry.level < currentLevel;
          const isLast = i === LEVELS.length - 1;
          // 本人视角：当前级的下一级展示达标进度；TL3 本级额外展示保级状态（窗口考核可回落）
          const showProgress =
            progress !== null && entry.level === currentLevel + 1 && entry.level <= 3;
          const showRetention = progress !== null && isCurrent && entry.level === 3;
          const reqs =
            progress !== null && (showProgress || showRetention)
              ? requirementsFor(entry.level, progress.stats, progress.thresholds)
              : [];
          const allMet = reqs.length > 0 && reqs.every(met);

          return (
            <li key={entry.level} className="relative flex gap-4 pb-1">
              {/* 驿站节点 + 连线 */}
              <div className="flex flex-col items-center">
                <span
                  aria-hidden
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xs font-serif text-sm leading-none ${
                    isCurrent
                      ? 'rotate-3 bg-accent-600 text-on-fill shadow-paper'
                      : isPassed
                        ? 'bg-brand-600 text-on-fill'
                        : entry.level === 4
                          ? 'border border-ink-300 border-dashed bg-paper-50 text-ink-400'
                          : 'border border-ink-300 bg-paper-50 text-ink-400'
                  }`}
                >
                  {isPassed ? '✓' : entry.level}
                </span>
                {!isLast ? (
                  <span
                    aria-hidden
                    className={`w-px flex-1 ${isPassed ? 'bg-brand-400' : 'bg-ink-200'}`}
                  />
                ) : null}
              </div>

              <div className={`min-w-0 flex-1 ${isLast ? '' : 'pb-6'}`}>
                <p className="flex flex-wrap items-center gap-2 pt-1.5">
                  <span
                    className={`font-medium font-serif ${
                      isCurrent ? 'text-ink-900' : isPassed ? 'text-ink-700' : 'text-ink-500'
                    }`}
                  >
                    TL{entry.level} · {TRUST_LEVEL_NAMES[entry.level]}
                  </span>
                  {isCurrent ? (
                    <span className="rounded-full bg-accent-50 px-2 py-0.5 font-medium text-accent-700 text-xs">
                      当前
                    </span>
                  ) : null}
                  {entry.note !== undefined ? (
                    <span className="text-ink-400 text-xs">{entry.note}</span>
                  ) : null}
                </p>
                <ul
                  className={`mt-1.5 flex flex-col gap-0.5 text-sm leading-relaxed ${
                    entry.level > currentLevel ? 'text-ink-400' : 'text-ink-600'
                  }`}
                >
                  {entry.abilities.map((a) => (
                    <li key={a} className="flex gap-2">
                      <span aria-hidden className="text-ink-300">
                        {entry.level <= currentLevel ? '＋' : '·'}
                      </span>
                      {a}
                    </li>
                  ))}
                </ul>

                {showProgress || showRetention ? (
                  <div className="mt-3 rounded-md border border-ink-200 bg-paper-50 p-3 shadow-paper">
                    <p className="font-medium text-ink-700 text-xs">
                      {showRetention ? '保级状态（滚动窗口考核）' : '晋升进度'}
                      {showProgress && allMet ? (
                        <span className="ml-2 text-moss-700">已达标，下次活动结算时自动晋升</span>
                      ) : null}
                      {showRetention && !allMet ? (
                        <span className="ml-2 text-ochre-700">有指标跌破阈值，结算时可能回落</span>
                      ) : null}
                    </p>
                    <ul className="mt-2 flex flex-col gap-2">
                      {reqs.map((r) => (
                        <RequirementRow key={r.label} r={r} />
                      ))}
                    </ul>
                  </div>
                ) : null}
                {progress !== null && isCurrent && entry.level === 3 ? (
                  <p className="mt-2 text-ink-400 text-xs leading-relaxed">
                    TL4 由社区提名并人工授予——持续的高质量贡献会被看见。
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {/* 作者特例 + 公共/私有两条线（ADR-0007 / ADR-0008） */}
      <div className="mt-8 border-ink-200/70 border-t pt-6">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span aria-hidden className="h-4 w-1 self-center rounded-xs bg-accent-600" />
          <h3 className="font-medium font-serif text-ink-800 text-base">
            协作权：公共页 / 私有页两条线
          </h3>
        </div>
        <p className="mt-2 text-ink-500 text-sm leading-relaxed">
          <span className="font-medium text-ink-700">对自己的文章</span>
          ，从注册起（TL0）就拥有完整协作权：直接编辑、审核与合并他人的编辑建议。 对
          <span className="font-medium text-ink-700">他人的文章</span>
          ，能做什么取决于页面是公共还是私有（能力阶梯：建议 ＜ 申请 ＜ 管理）：
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[28rem] border-collapse text-sm">
            <thead>
              <tr className="border-ink-200 border-b text-ink-500 text-xs">
                <th className="py-2 pr-3 text-left font-medium">谁（非作者）</th>
                <th className="px-3 py-2 text-left font-medium">🔒 私有页</th>
                <th className="px-3 py-2 text-left font-medium">🌐 公共页</th>
              </tr>
            </thead>
            <tbody className="text-ink-600">
              {[
                ['TL2 贡献者', '提编辑建议', '提编辑建议'],
                ['TL3 资深贡献者', '提编辑建议', '编辑申请（直编+巡查）'],
                ['责任编辑', '编辑申请（直编+巡查）', '审核管理（审/合建议+直编）'],
                ['板块版主及以上', '审核管理 + 治理控件', '审核管理 + 治理控件'],
              ].map((row) => (
                <tr key={row[0]} className="border-ink-100 border-b last:border-0 align-top">
                  <td className="py-2 pr-3 font-medium text-ink-700">{row[0]}</td>
                  <td className="px-3 py-2">{row[1]}</td>
                  <td className="px-3 py-2">{row[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-ink-400 text-xs leading-relaxed">
          私有页攒够「他人贡献」（建议 + 他人评论 + 他人署名的直编修订）达阈值会自动转为公共页，
          也可由管理员手动设置；升级后保留原作者署名。
        </p>
      </div>

      <p className="mt-6 text-ink-400 text-xs">
        阈值由站点治理配置并随社区规模调整；治理职务（编辑、板块版主等）由任命授予，不经此路线。
      </p>
    </section>
  );
}
