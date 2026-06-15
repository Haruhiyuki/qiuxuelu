'use client';

// 知识图谱（语雀式）：以当前帖为中心，按「站内提及」铺开最多三层邻域。
// 左侧力导向图（自包含 SVG，无第三方依赖）：渐变圆节点 + 文档字形 + 标题，柔和曲线边，
// 选中带光环、非邻居淡出；右侧信息面板（作者 / 更新时间 + 被引用 / 引用了）。
// 单击节点：选中并在右栏看详情；双击节点：打开其文章。布局确定性（无随机、不抖动）。
import { FileText } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useMemo, useState } from 'react';
import { formatDateTime } from '@/lib/format';
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
  const graph = initialGraph;
  const availDepth = useMemo(() => graph.nodes.reduce((m, n) => Math.max(m, n.depth), 0), [graph]);
  const layout = useMemo(() => computeLayout(graph, Math.max(1, availDepth)), [graph, availDepth]);
  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  const [selectedId, setSelectedId] = useState(graph.centerId);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [tab, setTab] = useState<'in' | 'out'>('in');

  const selected = nodeById.get(selectedId) ?? null;
  const incoming = useMemo(
    () =>
      graph.edges
        .filter((e) => e.target === selectedId)
        .map((e) => nodeById.get(e.source))
        .filter((x): x is LayeredNode => x !== undefined),
    [graph.edges, selectedId, nodeById],
  );
  const outgoing = useMemo(
    () =>
      graph.edges
        .filter((e) => e.source === selectedId)
        .map((e) => nodeById.get(e.target))
        .filter((x): x is LayeredNode => x !== undefined),
    [graph.edges, selectedId, nodeById],
  );

  // 焦点（hover 优先于 selected）+ 其直接邻居：用于高亮/淡出
  const focus = hoverId ?? selectedId;
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

          {layout.edges.map((e) => {
            const a = layout.posMap.get(e.source);
            const b = layout.posMap.get(e.target);
            if (a === undefined || b === undefined) {
              return null;
            }
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
                strokeOpacity={active ? 0.9 : 0.45}
              />
            );
          })}

          {layout.nodes.map((nd) => {
            const isSel = nd.id === selectedId;
            const dim = focus !== nd.id && !neighborIds.has(nd.id);
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: 图节点为指针增强，键盘可达路径由右栏列表按钮承担
              <g
                key={nd.id}
                transform={`translate(${nd.x} ${nd.y})`}
                className="cursor-pointer"
                style={{ opacity: dim ? 0.32 : 1, transition: 'opacity .15s ease' }}
                onClick={() => setSelectedId(nd.id)}
                onDoubleClick={() => router.push(`/a/${nd.slug}`)}
                onMouseEnter={() => setHoverId(nd.id)}
                onMouseLeave={() => setHoverId(null)}
              >
                {isSel ? (
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
                  className={isSel ? 'fill-ink-900 font-medium' : 'fill-ink-600'}
                  fontSize={13}
                >
                  {clip(nd.title, 12)}
                </text>
              </g>
            );
          })}
        </svg>
        <p className="absolute bottom-3 left-3 text-ink-400 text-xs">单击查看详情 · 双击打开文章</p>
        {graph.truncated ? (
          <p className="absolute right-3 bottom-3 text-ink-400 text-xs">关系较多，仅展示部分</p>
        ) : null}
      </div>

      {/* 右侧信息面板 */}
      <aside className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-ink-200/70 border-l p-4">
        {selected !== null ? (
          <>
            <div className="rounded-lg border border-ink-200 bg-paper-50 p-3 shadow-paper">
              <div className="flex items-start gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-brand-400 to-brand-600 text-on-fill">
                  <FileText className="h-4 w-4" aria-hidden />
                </span>
                <Link
                  href={`/a/${selected.slug}`}
                  className="min-w-0 font-medium font-serif text-ink-900 leading-snug transition-colors hover:text-brand-700"
                >
                  {selected.title}
                </Link>
              </div>
              <dl className="mt-3 flex flex-col gap-1.5 text-xs">
                <div className="flex gap-2">
                  <dt className="shrink-0 text-ink-400">作者</dt>
                  <dd className="truncate text-ink-600">{selected.authorName ?? '佚名'}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="shrink-0 text-ink-400">更新</dt>
                  <dd className="text-ink-600">{formatDateTime(new Date(selected.updatedAt))}</dd>
                </div>
              </dl>
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
                      onClick={() => setSelectedId(node.id)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ink-700 text-sm transition-colors hover:bg-paper-200"
                      title={node.title}
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0 text-brand-500" aria-hidden />
                      <span className="truncate">{node.title}</span>
                    </button>
                  </li>
                ))}
                {list.length === 0 ? (
                  <li className="px-2 py-3 text-ink-400 text-xs">
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
