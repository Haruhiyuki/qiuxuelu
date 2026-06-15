'use client';

// 知识图谱（语雀式）：以当前帖为中心，按「站内提及」铺开最多三层邻域。
// 左侧力导向图（自包含 SVG，无第三方依赖）：渐变圆节点 + 文档字形 + 标题，柔和曲线边，
// 每对节点只画一条线（无向去重）；中心带光环、非邻居淡出。
// 单击节点：把它移到中心（fetchDocGraph 取新邻域，旧节点平滑移位、新节点自中心渐入）；
// 双击节点：打开其文章。右栏信息面板（中心文档卡 + 作者/更新/关系 + 被引用/引用了列表）。
// 布局确定性（无随机、不抖动）；尊重 prefers-reduced-motion。
import { ArrowUpRight, FileText, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { formatDateTime } from '@/lib/format';
import { fetchDocGraph } from '@/server/actions/graph';
import type { LayeredGraph, LayeredNode } from '@/server/references';

const NODE_R = [27, 22, 19, 17]; // 各 depth 的节点半径（中心略大）
const VB_HALF = 450;
const FIT_MARGIN = 96;
const MAX_SCALE = 2.2;
const FIXED_VIEWBOX = `${-VB_HALF} ${-VB_HALF} ${VB_HALF * 2} ${VB_HALF * 2}`;
// 力导向（Fruchterman–Reingold + 按 depth 径向偏置；确定性）
const FR_K = 116;
const FR_ITERS = 440;
const FR_RING = 116;
const FR_RADIAL = 0.05;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const ANIM_MS = 480; // 换中心补间时长

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

interface PlacedNode extends LayeredNode {
  x: number;
  y: number;
  r: number;
}

interface Layout {
  nodes: PlacedNode[];
  edges: { source: string; target: string }[];
  posMap: Map<string, PlacedNode>;
}

function clip(s: string, n: number): string {
  return [...s].length > n ? `${[...s].slice(0, n).join('')}…` : s;
}

/** 力导向布局：黄金角种子 + 斥力/边弹簧 + 按 depth 径向偏置，中心钉原点；包围盒等比拟合居中。 */
function computeLayout(graph: LayeredGraph, maxDepth: number): Layout {
  const nodes = graph.nodes.filter((n) => n.depth <= maxDepth);
  const idSet = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter((e) => idSet.has(e.source) && idSet.has(e.target));
  const n = nodes.length;
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]));
  const centerIdx = nodes.findIndex((nd) => nd.depth === 0);

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
    for (let i = 0; i < n; i++) {
      const xi = px[i] ?? 0;
      const yi = py[i] ?? 0;
      for (let j = i + 1; j < n; j++) {
        let ddx = xi - (px[j] ?? 0);
        let ddy = yi - (py[j] ?? 0);
        let dist = Math.hypot(ddx, ddy);
        if (dist < 0.01) {
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

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const r = NODE_R[Math.min(nodes[i]?.depth ?? 0, NODE_R.length - 1)] ?? 12;
    const x = px[i] ?? 0;
    const y = py[i] ?? 0;
    minX = Math.min(minX, x - r);
    maxX = Math.max(maxX, x + r);
    minY = Math.min(minY, y - r);
    maxY = Math.max(maxY, y + r);
  }
  if (!Number.isFinite(minX)) {
    minX = -1;
    minY = -1;
    maxX = 1;
    maxY = 1;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const usable = (VB_HALF - FIT_MARGIN) * 2;
  const scale = Math.min(
    MAX_SCALE,
    usable / Math.max(1, maxX - minX),
    usable / Math.max(1, maxY - minY),
  );

  const placed: PlacedNode[] = nodes.map((nd, i) => ({
    ...nd,
    x: ((px[i] ?? 0) - cx) * scale,
    y: ((py[i] ?? 0) - cy) * scale,
    r: NODE_R[Math.min(nd.depth, NODE_R.length - 1)] ?? 12,
  }));

  return { nodes: placed, edges, posMap: new Map(placed.map((p) => [p.id, p])) };
}

/** 节点内的「文档」字形：三条白色横线（与语雀同款），随半径缩放。 */
function DocGlyph({ r }: { r: number }) {
  const w = r * 0.64;
  const x = -w / 2;
  const gap = r * 0.3;
  const sw = Math.max(2, r * 0.13);
  return (
    <g stroke="white" strokeWidth={sw} strokeLinecap="round">
      <line x1={x} y1={-gap} x2={x + w * 0.82} y2={-gap} />
      <line x1={x} y1={0} x2={x + w} y2={0} />
      <line x1={x} y1={gap} x2={x + w * 0.68} y2={gap} />
    </g>
  );
}

export function KnowledgeGraph({ initialGraph }: { initialGraph: LayeredGraph }) {
  const router = useRouter();
  const [graph, setGraph] = useState<LayeredGraph>(initialGraph);
  const [loading, setLoading] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [tab, setTab] = useState<'in' | 'out'>('in');

  const availDepth = useMemo(() => graph.nodes.reduce((m, n) => Math.max(m, n.depth), 0), [graph]);
  const layout = useMemo(() => computeLayout(graph, Math.max(1, availDepth)), [graph, availDepth]);
  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  // 每对节点只画一条线（无向去重）：A↔B 的双向引用合并为一条
  const drawEdges = useMemo(() => {
    const seen = new Set<string>();
    const out: { source: string; target: string }[] = [];
    for (const e of layout.edges) {
      const key = e.source < e.target ? `${e.source}|${e.target}` : `${e.target}|${e.source}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(e);
      }
    }
    return out;
  }, [layout.edges]);

  const centerId = graph.centerId;
  const center = nodeById.get(centerId) ?? null;
  const incoming = useMemo(
    () =>
      graph.edges
        .filter((e) => e.target === centerId)
        .map((e) => nodeById.get(e.source))
        .filter((x): x is LayeredNode => x !== undefined),
    [graph.edges, centerId, nodeById],
  );
  const outgoing = useMemo(
    () =>
      graph.edges
        .filter((e) => e.source === centerId)
        .map((e) => nodeById.get(e.target))
        .filter((x): x is LayeredNode => x !== undefined),
    [graph.edges, centerId, nodeById],
  );

  // 焦点（hover 优先于中心）+ 其直接邻居：高亮/淡出
  const focus = hoverId ?? centerId;
  const neighborIds = useMemo(() => {
    const s = new Set<string>([focus]);
    for (const e of graph.edges) {
      if (e.source === focus) {
        s.add(e.target);
      }
      if (e.target === focus) {
        s.add(e.source);
      }
    }
    return s;
  }, [graph.edges, focus]);

  // 节点坐标补间（rAF）：换中心时旧节点平滑移位、新节点自中心渐入
  const [pos, setPos] = useState<Map<string, { x: number; y: number; op: number }>>(
    () => new Map(layout.nodes.map((n) => [n.id, { x: n.x, y: n.y, op: 1 }])),
  );
  const posRef = useRef(pos);
  useEffect(() => {
    posRef.current = pos;
  });
  useEffect(() => {
    const targets = new Map(layout.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    const from = posRef.current;
    const startPos = new Map<string, { x: number; y: number; op: number }>();
    for (const id of targets.keys()) {
      startPos.set(id, from.get(id) ?? { x: 0, y: 0, op: 0 });
    }
    const reduce =
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setPos(new Map([...targets].map(([id, t]) => [id, { x: t.x, y: t.y, op: 1 }])));
      return;
    }
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    let raf = 0;
    const tick = (now: number) => {
      const e = easeOutCubic(Math.min(1, (now - t0) / ANIM_MS));
      const m = new Map<string, { x: number; y: number; op: number }>();
      for (const [id, tg] of targets) {
        const f = startPos.get(id) ?? { x: 0, y: 0, op: 0 };
        m.set(id, {
          x: f.x + (tg.x - f.x) * e,
          y: f.y + (tg.y - f.y) * e,
          op: f.op + (1 - f.op) * e,
        });
      }
      setPos(m);
      if (e < 1) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [layout]);

  async function recenter(id: string) {
    if (id === centerId || loading) {
      return;
    }
    setLoading(true);
    try {
      const g = await fetchDocGraph(id);
      if (g !== null) {
        setHoverId(null);
        setTab('in');
        setGraph(g);
      }
    } finally {
      setLoading(false);
    }
  }

  const list = tab === 'in' ? incoming : outgoing;

  return (
    <div className="flex h-full">
      <div className="relative min-w-0 flex-1">
        <svg
          viewBox={FIXED_VIEWBOX}
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full select-none"
          aria-label="知识图谱"
        >
          <defs>
            <linearGradient id="kg-node" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#6ea0f0" />
              <stop offset="100%" stopColor="#3b6fe0" />
            </linearGradient>
          </defs>

          {drawEdges.map((e) => {
            const a = pos.get(e.source) ?? { x: 0, y: 0, op: 0 };
            const b = pos.get(e.target) ?? { x: 0, y: 0, op: 0 };
            const active = focus === e.source || focus === e.target;
            const ddx = b.x - a.x;
            const ddy = b.y - a.y;
            const len = Math.hypot(ddx, ddy) || 1;
            const off = Math.min(46, len * 0.13);
            const cxp = (a.x + b.x) / 2 + (-ddy / len) * off;
            const cyp = (a.y + b.y) / 2 + (ddx / len) * off;
            return (
              <path
                key={`${e.source}-${e.target}`}
                d={`M ${a.x} ${a.y} Q ${cxp} ${cyp} ${b.x} ${b.y}`}
                fill="none"
                stroke={active ? 'var(--color-brand-400)' : 'var(--color-ink-300)'}
                strokeWidth={active ? 2 : 1.2}
                strokeOpacity={(active ? 0.9 : 0.4) * Math.min(a.op, b.op)}
              />
            );
          })}

          {layout.nodes.map((nd) => {
            const p = pos.get(nd.id) ?? { x: 0, y: 0, op: 0 };
            const isCenter = nd.id === centerId;
            const dim = focus !== nd.id && !neighborIds.has(nd.id);
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: 图节点为指针增强，键盘可达路径由右栏列表按钮承担
              <g
                key={nd.id}
                transform={`translate(${p.x} ${p.y})`}
                className="cursor-pointer"
                style={{ opacity: p.op * (dim ? 0.34 : 1) }}
                onClick={() => recenter(nd.id)}
                onDoubleClick={() => router.push(`/a/${nd.slug}`)}
                onMouseEnter={() => setHoverId(nd.id)}
                onMouseLeave={() => setHoverId(null)}
              >
                {isCenter ? (
                  <circle r={nd.r + 9} fill="var(--color-brand-400)" opacity={0.18} />
                ) : null}
                <circle
                  r={nd.r}
                  fill="url(#kg-node)"
                  opacity={nd.depth >= 3 ? 0.78 : nd.depth === 2 ? 0.9 : 1}
                  stroke="white"
                  strokeWidth={1.5}
                />
                <DocGlyph r={nd.r} />
                <text
                  y={nd.r + 17}
                  textAnchor="middle"
                  className={isCenter ? 'fill-ink-900 font-medium' : 'fill-ink-600'}
                  fontSize={13}
                >
                  {clip(nd.title, 12)}
                </text>
              </g>
            );
          })}
        </svg>
        {loading ? (
          <span className="absolute top-3 right-3 text-ink-400">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          </span>
        ) : null}
        <p className="absolute bottom-3 left-3 text-ink-400 text-xs">单击移到中心 · 双击打开文章</p>
        {graph.truncated ? (
          <p className="absolute right-3 bottom-3 text-ink-400 text-xs">关系较多，仅展示部分</p>
        ) : null}
      </div>

      {/* 右侧信息面板：当前中心文档 + 引用关系 */}
      <aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-ink-200/70 border-l bg-paper-100/40 p-4">
        {center !== null ? (
          <>
            <div className="rounded-lg border border-ink-200 bg-paper-50 p-4 shadow-paper">
              <div className="flex items-start gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-brand-400 to-brand-600 text-on-fill">
                  <FileText className="h-4 w-4" aria-hidden />
                </span>
                <h3 className="min-w-0 pt-0.5 font-medium font-serif text-base text-ink-900 leading-snug">
                  {center.title}
                </h3>
              </div>
              <dl className="mt-3.5 flex flex-col gap-2 text-sm">
                <div className="flex items-baseline gap-2">
                  <dt className="w-12 shrink-0 text-ink-400 text-xs">作者</dt>
                  <dd className="min-w-0 truncate text-ink-700">{center.authorName ?? '佚名'}</dd>
                </div>
                <div className="flex items-baseline gap-2">
                  <dt className="w-12 shrink-0 text-ink-400 text-xs">更新于</dt>
                  <dd className="text-ink-700">{formatDateTime(new Date(center.updatedAt))}</dd>
                </div>
                <div className="flex items-baseline gap-2">
                  <dt className="w-12 shrink-0 text-ink-400 text-xs">关系</dt>
                  <dd className="text-ink-700">
                    被引用 {incoming.length} · 引用了 {outgoing.length}
                  </dd>
                </div>
              </dl>
              <Link
                href={`/a/${center.slug}`}
                className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-fill py-2 font-medium text-on-fill text-sm transition-colors hover:bg-fill-hover"
              >
                打开文章
                <ArrowUpRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>

            <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-ink-200 bg-paper-50">
              <div className="flex border-ink-200/70 border-b text-sm">
                <TabBtn active={tab === 'in'} onClick={() => setTab('in')}>
                  被引用 {incoming.length}
                </TabBtn>
                <TabBtn active={tab === 'out'} onClick={() => setTab('out')}>
                  引用了 {outgoing.length}
                </TabBtn>
              </div>
              <ul className="min-h-0 flex-1 overflow-y-auto p-2">
                {list.map((node) => (
                  <li key={node.id}>
                    <button
                      type="button"
                      onClick={() => recenter(node.id)}
                      className="group flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-ink-700 text-sm transition-colors hover:bg-paper-200"
                      title={`${node.title}（${node.authorName ?? '佚名'}）`}
                    >
                      <FileText className="h-4 w-4 shrink-0 text-brand-500" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{node.title}</span>
                        <span className="block truncate text-ink-400 text-xs">
                          {node.authorName ?? '佚名'}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
                {list.length === 0 ? (
                  <li className="px-2 py-4 text-center text-ink-400 text-xs">
                    {tab === 'in' ? '还没有文章引用它' : '它还没有引用其它文章'}
                  </li>
                ) : null}
              </ul>
            </div>
          </>
        ) : null}
      </aside>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 px-3 py-2 font-medium transition-colors ${
        active
          ? '-mb-px border-brand-600 border-b-2 text-ink-900'
          : 'text-ink-400 hover:text-ink-700'
      }`}
    >
      {children}
    </button>
  );
}
