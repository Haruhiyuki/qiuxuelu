// 权限路线图（服务端组件，零 JS）：把信任等级体系画成竖向驿站图——
// 各级解锁的能力对所有访客公示（治理透明），达标进度仅本人可见。
// 能力清单与 @harublog/domain 的 TRUST_CAP_INCREMENTS / can() 语义一一对应；
// 阈值来自 site_settings（不硬编码），等级以 user_trust 物化值为准。
import type { TrustStats, TrustThresholds } from '@harublog/domain';
import { TRUST_LEVEL_NAMES, TRUST_TIERS } from '@/lib/trust-tiers';

// 等级称谓与权限来自共享数据（与社区公约权限表同源，二者永不分叉）；
// 再导出 TRUST_LEVEL_NAMES 供个人主页等沿用既有导入。
export { TRUST_LEVEL_NAMES } from '@/lib/trust-tiers';

interface Requirement {
  label: string;
  actual: number;
  required: number;
}

const met = (r: Requirement): boolean => r.actual >= r.required;

/** 指向 targetLevel 的达标条件（targetLevel ∈ 1|2|3；TL4 由管理员认证，无自动路径）。 */
function requirementsFor(
  targetLevel: number,
  stats: TrustStats,
  t: TrustThresholds,
): Requirement[] {
  switch (targetLevel) {
    case 1:
      return [{ label: '发布博客', actual: stats.publishedDocs, required: 1 }];
    case 2:
      return [{ label: '累计贡献分', actual: stats.points, required: t.tl2Points }];
    case 3:
      return [{ label: '近一年贡献分', actual: stats.windowPoints, required: t.tl3WindowPoints }];
    default:
      return [];
  }
}

function RequirementRow({ r }: { r: Requirement }) {
  const ok = met(r);
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
          {r.actual} / {r.required}
          {ok ? ' ✓' : ''}
        </span>
      </div>
      <div className="mt-1 ml-3 h-1 overflow-hidden rounded-full bg-ink-100" aria-hidden>
        <div
          className={`h-full rounded-full ${ok ? 'bg-moss-600' : 'bg-brand-500'}`}
          style={{ width: `${Math.min(100, (r.actual / Math.max(1, r.required)) * 100)}%` }}
        />
      </div>
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
      </div>

      {/* 升级路径：横向卡片，逐级解锁；当前级高亮，已过级打勾。
          权限按「个人博客 / 公共页面」两线展示，与社区公约的权限表对齐 */}
      <div className="-mx-1 mt-5 flex gap-3 overflow-x-auto px-1 pb-2">
        {TRUST_TIERS.map((entry) => {
          const isCurrent = entry.level === currentLevel;
          const isPassed = entry.level < currentLevel;
          const dim = entry.level > currentLevel;
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
                  className={`font-medium font-serif text-sm ${dim ? 'text-ink-500' : 'text-ink-900'}`}
                >
                  TL{entry.level} · {entry.name}
                </span>
              </div>
              {isCurrent ? (
                <span className="mt-2 inline-flex w-fit rounded-full bg-accent-50 px-2 py-0.5 font-medium text-accent-700 text-xs">
                  当前
                </span>
              ) : entry.note !== undefined ? (
                <span className="mt-2 text-ink-400 text-xs">{entry.note}</span>
              ) : null}
              {/* 与社区公约权限表对齐：个人博客 / 公共页面 两线，「＋」为相对上一级新增 */}
              <dl className="mt-2.5 flex flex-col gap-2 text-xs leading-relaxed">
                <div>
                  <dt className="text-ink-400">🔒 个人博客</dt>
                  <dd className={`mt-0.5 ${dim ? 'text-ink-400' : 'text-ink-700'}`}>
                    {entry.priv}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-400">🌐 公共页面</dt>
                  <dd className={`mt-0.5 ${dim ? 'text-ink-400' : 'text-ink-700'}`}>{entry.pub}</dd>
                </div>
              </dl>
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
              : '保级状态（近一年窗口考核）'}
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
          TL4（共建者）在 TL3 基础上由管理员颁发认证授予——持续的高质量贡献会被看见。
        </p>
      ) : null}
    </section>
  );
}
