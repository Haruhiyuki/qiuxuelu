'use client';

// 知识图谱：以当前帖子为中心，按「站内提及」关系铺开最多三层的邻域子图。
// 自包含 SVG（无第三方依赖）：放射式 tidy-tree 布局（按子树叶子数分配扇区，减少交叉）+
// requestAnimationFrame 补间动画。点击外层节点即把它设为新中心、拉取并切换图谱；点击中心
// 节点打开其文章。支持 1/2/3 层切换、悬停高亮邻域、层级导引环。
import { ArrowUpRight, Loader2, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchDocGraph } from '@/server/actions/graph';
import type { LayeredGraph, LayeredNode } from '@/server/references';

const PAD = 60; // viewBox 四周留白（含标签）
const NODE_R = [30, 20, 15, 12]; // 各 depth 的节点半径
// 力导向布局参数（Fruchterman–Reingold + 按 depth 的径向偏置；确定性、无随机）
const FR_K = 116; // 理想边长 / 斥力尺度
const FR_ITERS = 440;
const FR_RING = 104; // 每层径向偏置目标半径
const FR_RADIAL = 0.05; // 径向偏置强度（把节点温柔拉向其层环）
const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // 黄金角：种子均匀展开，避免初始对称塌成直线
const ANIM_MS = 460;

// 中心朱砂为焦点，外层黛青随距离渐淡——单一色相的「由近及远」读法
const DEPTH_FILL = [
  'var(--color-accent-600)',
  'var(--color-brand-600)',
  'var(--color-brand-400)',
  'var(--color-brand-300)',
];
const DEPTH_LEGEND = ['本帖', '第一层', '第二层', '第三层'];

interface PlacedNode extends LayeredNode {
  x: number;
  y: number;
  r: number;
}

interface Layout {
  nodes: PlacedNode[];
  edges: { source: string; target: string }[];
  posMap: Map<string, PlacedNode>;
  viewBox: string;
}

function clip(s: string, n: number): string {
  return [...s].length > n ? `${[...s].slice(0, n).join('')}…` : s;
}

/**
 * 力导向布局（Fruchterman–Reingold）：黄金角种子初始化 + 斥力/边弹簧 + 按 depth 的径向偏置，
 * 中心钉在原点。径向偏置让层次可读（越深越外），斥力把链状图谱铺开而非塌成直线。
 * 全程无随机，迭代固定步数 → 同图同布局（不抖动）。
 */
function computeLayout(graph: LayeredGraph, maxDepth: number): Layout {
  const nodes = graph.nodes.filter((n) => n.depth <= maxDepth);
  const idSet = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter((e) => idSet.has(e.source) && idSet.has(e.target));
  const n = nodes.length;
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]));
  const centerIdx = nodes.findIndex((nd) => nd.depth === 0);

  // 种子：中心在原点，其余按全局序号沿黄金角螺旋撒在各自层环附近
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = nodes[i]?.depth ?? 1;
    if (d === 0) {
      continue;
    }
    const a = i * GOLDEN;
    const r = d * FR_RING;
    px[i] = Math.cos(a) * r;
    py[i] = Math.sin(a) * r;
  }

  const E: [number, number][] = [];
  for (const e of edges) {
    const a = idx.get(e.source);
    const b = idx.get(e.target);
    if (a !== undefined && b !== undefined && a !== b) {
      E.push([a, b]);
    }
  }

  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  for (let it = 0; it < FR_ITERS; it++) {
    const temp = FR_K * 0.92 * (1 - it / FR_ITERS) + 1.5;
    dx.fill(0);
    dy.fill(0);
    // 斥力（全对）：f = k²/dist
    for (let i = 0; i < n; i++) {
      const xi = px[i] ?? 0;
      const yi = py[i] ?? 0;
      for (let j = i + 1; j < n; j++) {
        let ddx = xi - (px[j] ?? 0);
        let ddy = yi - (py[j] ?? 0);
        let dist = Math.hypot(ddx, ddy);
        if (dist < 0.01) {
          // 重合时给个确定性的小扰动，避免除零与卡死
          ddx = (i - j) * 0.01 + 0.02;
          ddy = 0.01;
          dist = Math.hypot(ddx, ddy);
        }
        const f = (FR_K * FR_K) / dist;
        const ux = (ddx / dist) * f;
        const uy = (ddy / dist) * f;
        dx[i] = (dx[i] ?? 0) + ux;
        dy[i] = (dy[i] ?? 0) + uy;
        dx[j] = (dx[j] ?? 0) - ux;
        dy[j] = (dy[j] ?? 0) - uy;
      }
    }
    // 边弹簧（吸引）：f = dist²/k
    for (const [a, b] of E) {
      const ddx = (px[a] ?? 0) - (px[b] ?? 0);
      const ddy = (py[a] ?? 0) - (py[b] ?? 0);
      const dist = Math.hypot(ddx, ddy) || 0.01;
      const f = (dist * dist) / FR_K;
      const ux = (ddx / dist) * f;
      const uy = (ddy / dist) * f;
      dx[a] = (dx[a] ?? 0) - ux;
      dy[a] = (dy[a] ?? 0) - uy;
      dx[b] = (dx[b] ?? 0) + ux;
      dy[b] = (dy[b] ?? 0) + uy;
    }
    // 径向偏置：把每个节点温柔拉向其层环 depth·FR_RING
    for (let i = 0; i < n; i++) {
      const d = nodes[i]?.depth ?? 0;
      if (d === 0) {
        continue;
      }
      const xi = px[i] ?? 0;
      const yi = py[i] ?? 0;
      const r = Math.hypot(xi, yi) || 0.01;
      const pull = FR_RADIAL * (d * FR_RING - r) * 12;
      dx[i] = (dx[i] ?? 0) + (xi / r) * pull;
      dy[i] = (dy[i] ?? 0) + (yi / r) * pull;
    }
    // 积分（限步 + 冷却），中心钉死
    for (let i = 0; i < n; i++) {
      if (i === centerIdx) {
        px[i] = 0;
        py[i] = 0;
        continue;
      }
      const ddx = dx[i] ?? 0;
      const ddy = dy[i] ?? 0;
      const dl = Math.hypot(ddx, ddy);
      if (dl > 0) {
        const step = Math.min(dl, temp);
        px[i] = (px[i] ?? 0) + (ddx / dl) * step;
        py[i] = (py[i] ?? 0) + (ddy / dl) * step;
      }
    }
  }

  const placed: PlacedNode[] = nodes.map((nd, i) => ({
    ...nd,
    x: px[i] ?? 0,
    y: py[i] ?? 0,
    r: NODE_R[Math.min(nd.depth, NODE_R.length - 1)] ?? 12,
  }));

  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  for (const p of placed) {
    minX = Math.min(minX, p.x - p.r);
    maxX = Math.max(maxX, p.x + p.r);
    minY = Math.min(minY, p.y - p.r);
    maxY = Math.max(maxY, p.y + p.r);
  }
  minX -= PAD;
  minY -= PAD;
  maxX += PAD;
  maxY += PAD;

  return {
    nodes: placed,
    edges,
    posMap: new Map(placed.map((p) => [p.id, p])),
    viewBox: `${minX} ${minY} ${maxX - minX} ${maxY - minY}`,
  };
}

export function KnowledgeGraph({ initialGraph }: { initialGraph: LayeredGraph }) {
  const [graph, setGraph] = useState<LayeredGraph>(initialGraph);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [depth, setDepth] = useState(3);

  const availDepth = useMemo(
    () => graph.nodes.reduce((m, n) => Math.max(m, n.depth), 0),
    [graph.nodes],
  );
  const shownDepth = Math.min(depth, Math.max(1, availDepth));

  const target = useMemo(() => computeLayout(graph, shownDepth), [graph, shownDepth]);

  // 节点坐标补间（rAF）：新中心/层级切换时平滑过渡；新节点从原点展开
  const [pos, setPos] = useState<Map<string, { x: number; y: number }>>(
    () => new Map(target.nodes.map((n) => [n.id, { x: n.x, y: n.y }])),
  );
  const posRef = useRef(pos);
  useEffect(() => {
    posRef.current = pos;
  });

  useEffect(() => {
    const targetMap = new Map(target.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    const reduce =
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setPos(targetMap);
      return;
    }
    const start = new Map<string, { x: number; y: number }>();
    for (const n of target.nodes) {
      start.set(n.id, posRef.current.get(n.id) ?? { x: 0, y: 0 });
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ANIM_MS);
      const e = 1 - (1 - k) ** 3; // easeOutCubic
      const m = new Map<string, { x: number; y: number }>();
      for (const n of target.nodes) {
        const s = start.get(n.id) ?? { x: 0, y: 0 };
        const tg = targetMap.get(n.id) ?? { x: 0, y: 0 };
        m.set(n.id, { x: s.x + (tg.x - s.x) * e, y: s.y + (tg.y - s.y) * e });
      }
      setPos(m);
      if (k < 1) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  const center = graph.nodes.find((n) => n.depth === 0);
  const isOriginal = graph.centerId === initialGraph.centerId;

  // 悬停某节点：其邻域高亮，余者淡出
  const connected = useMemo(() => {
    if (hover === null) {
      return null;
    }
    const set = new Set<string>([hover]);
    for (const e of target.edges) {
      if (e.source === hover) {
        set.add(e.target);
      } else if (e.target === hover) {
        set.add(e.source);
      }
    }
    return set;
  }, [hover, target.edges]);

  function recenter(id: string) {
    if (id === graph.centerId || loading) {
      return;
    }
    setLoading(true);
    setHover(null);
    fetchDocGraph(id)
      .then((g) => {
        if (g !== null && g.nodes.length > 0) {
          setGraph(g);
        }
      })
      .finally(() => setLoading(false));
  }

  const at = (id: string) => pos.get(id) ?? target.posMap.get(id) ?? { x: 0, y: 0 };
  const nodeDim = (id: string) => connected !== null && !connected.has(id);
  const showLabel = (n: PlacedNode) =>
    n.depth <= 1 || target.nodes.length <= 22 || (connected?.has(n.id) ?? false);

  return (
    <div className="rounded-md border border-ink-200 bg-paper-50 shadow-paper">
      {/* 工具条：当前中心 + 打开文章 / 层级切换 / 返回本帖 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-ink-200/70 border-b px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-ink-400 text-xs">中心</span>
          {center !== undefined ? (
            <Link
              href={`/a/${center.slug}`}
              className="group inline-flex min-w-0 items-center gap-1 font-medium text-ink-800 text-sm transition-colors hover:text-brand-700"
            >
              <span className="truncate">{center.title}</span>
              <ArrowUpRight
                className="h-3.5 w-3.5 shrink-0 text-ink-400 transition-colors group-hover:text-brand-600"
                aria-hidden
              />
            </Link>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {availDepth >= 2 ? (
            <fieldset
              className="m-0 flex min-w-0 items-center gap-0.5 rounded-full border border-ink-200 bg-paper-100 p-0.5"
              aria-label="展开层级"
            >
              {Array.from({ length: Math.min(3, availDepth) }, (_, i) => i + 1).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDepth(d)}
                  aria-pressed={shownDepth === d}
                  className={`h-6 w-7 rounded-full text-xs transition-colors ${
                    shownDepth === d
                      ? 'bg-brand-600 font-medium text-on-fill'
                      : 'text-ink-500 hover:text-ink-800'
                  }`}
                >
                  {d}
                </button>
              ))}
              <span className="pr-1.5 pl-0.5 text-ink-400 text-xs">层</span>
            </fieldset>
          ) : null}
          {!isOriginal ? (
            <button
              type="button"
              onClick={() => {
                setGraph(initialGraph);
                setHover(null);
              }}
              className="inline-flex items-center gap-1 text-ink-500 text-xs transition-colors hover:text-brand-700"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              返回本帖
            </button>
          ) : null}
        </div>
      </div>

      <div className="relative">
        <svg
          viewBox={target.viewBox}
          preserveAspectRatio="xMidYMid meet"
          className="block h-auto w-full select-none"
          style={{ maxHeight: 'min(68vh, 560px)' }}
          role="img"
          aria-label={`以「${center?.title ?? ''}」为中心、最多 ${shownDepth} 层的站内提及关系图`}
        >
          <defs>
            <marker
              id="kg-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6.5"
              markerHeight="6.5"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill="var(--color-ink-400)" />
            </marker>
            <filter id="kg-shadow" x="-40%" y="-40%" width="180%" height="180%">
              <feDropShadow
                dx="0"
                dy="1.5"
                stdDeviation="2.5"
                floodColor="var(--color-ink-900)"
                floodOpacity="0.16"
              />
            </filter>
          </defs>

          {/* 层级导引环（淡虚线，对齐径向偏置半径）：暗示「由内向外分层」 */}
          {Array.from({ length: shownDepth }, (_, i) => i + 1).map((d) => (
            <circle
              key={`ring-${d}`}
              cx={0}
              cy={0}
              r={d * FR_RING}
              fill="none"
              stroke="var(--color-ink-200)"
              strokeWidth={1}
              strokeDasharray="2 7"
              opacity={0.45}
            />
          ))}

          {/* 边（有向曲线）：双向边朝相反方向起拱以错开 */}
          {target.edges.map((e) => {
            const a = at(e.source);
            const b = at(e.target);
            const ra = target.posMap.get(e.source)?.r ?? 6;
            const rb = target.posMap.get(e.target)?.r ?? 6;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            const ux = dx / len;
            const uy = dy / len;
            const x1 = a.x + ux * ra;
            const y1 = a.y + uy * ra;
            const x2 = b.x - ux * (rb + 5);
            const y2 = b.y - uy * (rb + 5);
            // 垂直于连线的小拱；方向由端点排序决定，避免互指边重叠
            const bow = (e.source < e.target ? 1 : -1) * len * 0.12;
            const cx = (x1 + x2) / 2 - uy * bow;
            const cy = (y1 + y2) / 2 + ux * bow;
            // 高亮：悬停节点的相连边（端点之一即为 hover）
            const active = hover !== null && (e.source === hover || e.target === hover);
            const dim = hover !== null && !active;
            return (
              <path
                key={`${e.source}->${e.target}`}
                d={`M${x1},${y1} Q${cx},${cy} ${x2},${y2}`}
                fill="none"
                stroke={active ? 'var(--color-brand-500)' : 'var(--color-ink-300)'}
                strokeWidth={active ? 2 : 1.4}
                markerEnd="url(#kg-arrow)"
                opacity={dim ? 0.12 : 0.7}
                className="transition-opacity duration-150"
              />
            );
          })}

          {/* 节点 */}
          {target.nodes.map((n) => {
            const p = at(n.id);
            const fill = DEPTH_FILL[Math.min(n.depth, DEPTH_FILL.length - 1)];
            const dim = nodeDim(n.id);
            const isCenter = n.depth === 0;
            const label = (
              <text
                x={0}
                y={n.r + 14}
                textAnchor="middle"
                className="fill-[var(--color-ink-700)]"
                style={{
                  paintOrder: 'stroke',
                  stroke: 'var(--color-paper-50)',
                  strokeWidth: 3,
                  strokeLinejoin: 'round',
                }}
                fontSize={isCenter ? 12.5 : n.depth === 1 ? 11.5 : 10.5}
                fontWeight={isCenter ? 600 : 400}
              >
                {clip(n.title, isCenter ? 16 : n.depth === 1 ? 12 : 9)}
              </text>
            );
            const circle = (
              <circle
                r={n.r}
                fill={fill}
                stroke="var(--color-paper-50)"
                strokeWidth={2.5}
                filter="url(#kg-shadow)"
              />
            );
            const inner =
              isCenter || hover === n.id ? (
                <circle
                  r={n.r}
                  fill="none"
                  stroke="var(--color-paper-50)"
                  strokeOpacity={0.55}
                  strokeWidth={1}
                  transform="scale(0.7)"
                />
              ) : null;

            // 中心节点 → 打开文章；外层节点 → 设为新中心
            const common = {
              transform: `translate(${p.x},${p.y})`,
              opacity: dim ? 0.22 : 1,
              className: 'transition-opacity duration-150',
              onMouseEnter: () => setHover(n.id),
              onMouseLeave: () => setHover(null),
            };
            if (isCenter) {
              return (
                <Link key={n.id} href={`/a/${n.slug}`} aria-label={`打开本文：${n.title}`}>
                  <g {...common} style={{ cursor: 'pointer' }}>
                    {circle}
                    {inner}
                    <text
                      x={0}
                      y={0}
                      textAnchor="middle"
                      dominantBaseline="central"
                      className="fill-[var(--color-on-fill)] font-serif"
                      fontSize={12}
                    >
                      本帖
                    </text>
                    {label}
                  </g>
                </Link>
              );
            }
            return (
              // biome-ignore lint/a11y/useSemanticElements: SVG 内无法用原生 <button>，作图节点以 role=button + 键盘处理承载交互
              <g
                key={n.id}
                {...common}
                role="button"
                tabIndex={0}
                aria-label={`以「${n.title}」为中心查看图谱`}
                style={{ cursor: 'pointer' }}
                onClick={() => recenter(n.id)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    recenter(n.id);
                  }
                }}
              >
                {circle}
                {inner}
                {showLabel(n) ? label : null}
              </g>
            );
          })}
        </svg>

        {/* 切换中心时的加载遮罩 */}
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-paper-50/55 backdrop-blur-[1px]">
            <Loader2 className="h-6 w-6 animate-spin text-brand-600" aria-hidden />
          </div>
        ) : null}
      </div>

      {/* 图例 + 操作提示 */}
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-ink-200/70 border-t px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-400 text-xs">
          {DEPTH_LEGEND.slice(0, shownDepth + 1).map((lbl, i) => (
            <span key={lbl} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: DEPTH_FILL[i] }}
              />
              {lbl}
            </span>
          ))}
        </div>
        <p className="text-ink-400 text-xs">点击节点切换中心 · 点击本帖打开文章</p>
      </div>
    </div>
  );
}
