'use client';

// 知识图谱（语雀式）：以当前帖为中心，按「站内提及」铺开最多三层邻域。
// 关键：节点用「持久世界坐标」——一旦排好就不再重算，换中心时既有节点原地不动，
// 只「平移/缩放视窗」到新邻域、并让新节点就地渐入。于是是在一张稳定的图上逐步探索，
// 视角方向基本不变（绝不翻转）。初次布局走力导向（FR + 按 depth 径向分层）；之后增量：
// 既有节点钉死，仅把新节点放到其锚点附近做轻量松弛避免重叠。
// 单击节点：把它移到视角中心（fetchDocGraph 取新邻域）；双击节点：打开其博客。
// 每对节点只画一条线（无向去重）；尊重 prefers-reduced-motion。
import { ArrowUpRight, FileText, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { formatDateTime } from '@/lib/format';
import { fetchDocGraph } from '@/server/actions/graph';
import type { LayeredGraph, LayeredNode } from '@/server/references';

const NODE_R = [27, 22, 19, 17]; // 各 depth 的节点半径（中心略大）
// 力导向（Fruchterman–Reingold + 按 depth 径向偏置；确定性）
const FR_K = 116;
const FR_ITERS = 440;
const FR_RING = 116;
const FR_RADIAL = 0.05;
const INC_ITERS = 180; // 增量布局：只松弛新节点的迭代数
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const ANIM_MS = 520; // 平移/缩放视窗 + 新节点渐入时长
const BASE_VIEW = 880; // 视窗基准边长：据当前缩放反向缩放字号/线宽，保持视觉大小稳定
const MIN_VIEW = 360; // 视窗最小边长：少节点时不过度放大
const VIEW_MARGIN = 72; // 视窗留白（世界单位）

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

interface Pos {
  x: number;
  y: number;
}

interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

function clip(s: string, n: number): string {
  return [...s].length > n ? `${[...s].slice(0, n).join('')}…` : s;
}

function radiusFor(depth: number): number {
  return NODE_R[Math.min(depth, NODE_R.length - 1)] ?? 12;
}

/**
 * 力导向松弛（原地改写 pos）：斥力（全对）+ 边弹簧 +（可选）按 depth 的径向偏置。
 * pinned 中的节点只施力不移动——初次布局钉中心，增量布局钉全部既有节点。
 * depthOf 非空时启用径向分层（围绕世界原点），仅用于初次整图布局。
 */
function relax(
  ids: string[],
  pos: Map<string, Pos>,
  edges: { source: string; target: string }[],
  pinned: Set<string>,
  iters: number,
  depthOf: Map<string, number> | null,
): void {
  const n = ids.length;
  const idx = new Map(ids.map((id, i) => [id, i]));
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const pin = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const id = ids[i] as string;
    const p = pos.get(id);
    px[i] = p?.x ?? 0;
    py[i] = p?.y ?? 0;
    pin[i] = pinned.has(id) ? 1 : 0;
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
  for (let it = 0; it < iters; it++) {
    const temp = FR_K * 0.92 * (1 - it / iters) + 1.5;
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
    if (depthOf !== null) {
      for (let i = 0; i < n; i++) {
        const d = depthOf.get(ids[i] as string) ?? 0;
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
    }
    for (let i = 0; i < n; i++) {
      if (pin[i] === 1) {
        continue;
      }
      const fdx = dx[i] ?? 0;
      const fdy = dy[i] ?? 0;
      const dl = Math.hypot(fdx, fdy);
      if (dl > 0) {
        const step = Math.min(dl, temp);
        px[i] = (px[i] ?? 0) + (fdx / dl) * step;
        py[i] = (py[i] ?? 0) + (fdy / dl) * step;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    if (pin[i] === 0) {
      pos.set(ids[i] as string, { x: px[i] ?? 0, y: py[i] ?? 0 });
    }
  }
}

/** 初次整图布局：黄金角种子 + 中心钉原点 + 按 depth 径向分层。写入 world。 */
function frInitial(world: Map<string, Pos>, graph: LayeredGraph): void {
  graph.nodes.forEach((nd, i) => {
    if (nd.depth === 0) {
      world.set(nd.id, { x: 0, y: 0 });
    } else {
      const a = i * GOLDEN;
      const r = nd.depth * FR_RING;
      world.set(nd.id, { x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
  });
  const pinned = new Set(graph.nodes.filter((n) => n.depth === 0).map((n) => n.id));
  const depthOf = new Map(graph.nodes.map((n) => [n.id, n.depth]));
  relax(
    graph.nodes.map((n) => n.id),
    world,
    graph.edges,
    pinned,
    FR_ITERS,
    depthOf,
  );
}

/** 增量布局：既有节点全部钉死，仅把新节点放到锚点附近、做轻量松弛避免重叠。 */
function placeIncremental(world: Map<string, Pos>, graph: LayeredGraph): void {
  const newNodes = graph.nodes.filter((n) => !world.has(n.id));
  if (newNodes.length === 0) {
    return;
  }
  // 邻接（用于给新节点找已定位的锚点）
  const adj = new Map<string, string[]>();
  const add = (a: string, b: string) => {
    const arr = adj.get(a);
    if (arr === undefined) {
      adj.set(a, [b]);
    } else {
      arr.push(b);
    }
  };
  for (const e of graph.edges) {
    add(e.source, e.target);
    add(e.target, e.source);
  }
  const newSet = new Set(newNodes.map((n) => n.id));
  const centerPos = world.get(graph.centerId) ?? { x: 0, y: 0 };
  newNodes.forEach((nd, i) => {
    // 锚点：优先选已定位的邻居，否则退回当前中心
    let ax = centerPos.x;
    let ay = centerPos.y;
    for (const m of adj.get(nd.id) ?? []) {
      const p = world.get(m);
      if (p !== undefined && !newSet.has(m)) {
        ax = p.x;
        ay = p.y;
        break;
      }
    }
    const a = i * GOLDEN;
    world.set(nd.id, { x: ax + Math.cos(a) * FR_RING, y: ay + Math.sin(a) * FR_RING });
  });
  const pinned = new Set(graph.nodes.filter((n) => !newSet.has(n.id)).map((n) => n.id));
  relax(
    graph.nodes.map((n) => n.id),
    world,
    graph.edges,
    pinned,
    INC_ITERS,
    null,
  );
}

/** 确保 graph 的全部节点都有世界坐标：world 空走整图布局，否则增量补新节点。 */
function placeGraph(world: Map<string, Pos>, graph: LayeredGraph): void {
  if (world.size === 0) {
    frInitial(world, graph);
  } else {
    placeIncremental(world, graph);
  }
}

/** 据当前 graph 节点的世界坐标算出「正方形视窗」（含标签留白），少节点时设最小边长。 */
function computeView(graph: LayeredGraph, world: Map<string, Pos>): View {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const nd of graph.nodes) {
    const p = world.get(nd.id);
    if (p === undefined) {
      continue;
    }
    const pad = radiusFor(nd.depth) + 28; // 给节点下方标题留白
    minX = Math.min(minX, p.x - pad);
    maxX = Math.max(maxX, p.x + pad);
    minY = Math.min(minY, p.y - pad);
    maxY = Math.max(maxY, p.y + pad);
  }
  if (!Number.isFinite(minX)) {
    minX = -100;
    minY = -100;
    maxX = 100;
    maxY = 100;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const side = Math.max(maxX - minX, maxY - minY, MIN_VIEW) + VIEW_MARGIN * 2;
  return { x: cx - side / 2, y: cy - side / 2, w: side, h: side };
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
  // 持久世界坐标：跨「换中心」不重算，既有节点原地不动
  const worldRef = useRef<Map<string, Pos>>(new Map());

  const [graph, setGraph] = useState<LayeredGraph>(() => {
    placeGraph(worldRef.current, initialGraph);
    return initialGraph;
  });
  const [loading, setLoading] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [tab, setTab] = useState<'in' | 'out'>('in');

  // 视窗（平移/缩放的补间目标）
  const [view, setView] = useState<View>(() => computeView(initialGraph, worldRef.current));
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  });

  // 节点不透明度：新出现的节点 0→1 渐入；既有节点恒为 1（不移动、不闪烁）
  const [fade, setFade] = useState<Map<string, number>>(
    () => new Map(initialGraph.nodes.map((n) => [n.id, 1])),
  );
  const fadeRef = useRef(fade);
  useEffect(() => {
    fadeRef.current = fade;
  });

  // 换图：把视窗平移/缩放到新邻域 + 新节点就地渐入；既有节点世界坐标不变（不翻转）
  useEffect(() => {
    const target = computeView(graph, worldRef.current);
    const fromView = viewRef.current;
    const startFade = new Map<string, number>();
    for (const nd of graph.nodes) {
      startFade.set(nd.id, fadeRef.current.get(nd.id) ?? 0);
    }
    const allShown = new Map<string, number>(graph.nodes.map((n) => [n.id, 1]));
    const reduce =
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const settled =
      Math.abs(fromView.x - target.x) < 0.5 &&
      Math.abs(fromView.y - target.y) < 0.5 &&
      Math.abs(fromView.w - target.w) < 0.5 &&
      [...startFade.values()].every((v) => v >= 1);
    if (reduce || settled) {
      setView(target);
      setFade(allShown);
      return;
    }
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    let raf = 0;
    const tick = (now: number) => {
      const e = easeOutCubic(Math.min(1, (now - t0) / ANIM_MS));
      setView({
        x: fromView.x + (target.x - fromView.x) * e,
        y: fromView.y + (target.y - fromView.y) * e,
        w: fromView.w + (target.w - fromView.w) * e,
        h: fromView.h + (target.h - fromView.h) * e,
      });
      const f = new Map<string, number>();
      for (const [id, s] of startFade) {
        f.set(id, s + (1 - s) * e);
      }
      setFade(f);
      if (e < 1) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [graph]);

  const centerId = graph.centerId;
  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const center = nodeById.get(centerId) ?? null;

  // 每对节点只画一条线（无向去重）：A↔B 的双向引用合并为一条
  const drawEdges = useMemo(() => {
    const seen = new Set<string>();
    const out: { source: string; target: string }[] = [];
    for (const e of graph.edges) {
      const key = e.source < e.target ? `${e.source}|${e.target}` : `${e.target}|${e.source}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(e);
      }
    }
    return out;
  }, [graph.edges]);

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

  async function recenter(id: string) {
    if (id === centerId || loading) {
      return;
    }
    setLoading(true);
    try {
      const g = await fetchDocGraph(id);
      if (g !== null) {
        placeGraph(worldRef.current, g); // 先补齐新节点世界坐标，再切图
        setHoverId(null);
        setTab('in');
        setGraph(g);
      }
    } finally {
      setLoading(false);
    }
  }

  const list = tab === 'in' ? incoming : outgoing;
  const world = worldRef.current;
  // 视窗缩放系数：反向缩放字号/线宽，使其屏幕视觉大小基本恒定
  const k = Math.min(2, Math.max(0.62, view.w / BASE_VIEW));

  return (
    <div className="flex h-full">
      <div className="relative min-w-0 flex-1">
        <svg
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
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
            const a = world.get(e.source);
            const b = world.get(e.target);
            if (a === undefined || b === undefined) {
              return null;
            }
            const op = Math.min(fade.get(e.source) ?? 1, fade.get(e.target) ?? 1);
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
                strokeWidth={(active ? 2 : 1.2) * k}
                strokeOpacity={(active ? 0.9 : 0.4) * op}
              />
            );
          })}

          {graph.nodes.map((nd) => {
            const p = world.get(nd.id);
            if (p === undefined) {
              return null;
            }
            const op = fade.get(nd.id) ?? 1;
            const isCenter = nd.id === centerId;
            const dim = focus !== nd.id && !neighborIds.has(nd.id);
            const r = radiusFor(nd.depth);
            const s = 0.72 + 0.28 * op; // 新节点轻微放大入场
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: 图节点为指针增强，键盘可达路径由右栏列表按钮承担
              <g
                key={nd.id}
                transform={`translate(${p.x} ${p.y}) scale(${s})`}
                className="cursor-pointer"
                style={{ opacity: op * (dim ? 0.34 : 1) }}
                onClick={() => recenter(nd.id)}
                onDoubleClick={() => router.push(`/a/${nd.slug}`)}
                onMouseEnter={() => setHoverId(nd.id)}
                onMouseLeave={() => setHoverId(null)}
              >
                {isCenter ? (
                  <circle r={r + 9} fill="var(--color-brand-400)" opacity={0.18} />
                ) : null}
                <circle
                  r={r}
                  fill="url(#kg-node)"
                  opacity={nd.depth >= 3 ? 0.78 : nd.depth === 2 ? 0.9 : 1}
                  stroke="white"
                  strokeWidth={1.5}
                />
                <DocGlyph r={r} />
                <text
                  y={r + 5 + 13 * k}
                  textAnchor="middle"
                  className={isCenter ? 'fill-ink-900 font-medium' : 'fill-ink-600'}
                  fontSize={13 * k}
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
        <p className="absolute bottom-3 left-3 text-ink-400 text-xs">单击移到中心 · 双击打开博客</p>
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
                打开博客
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
                    {tab === 'in' ? '还没有博客引用它' : '它还没有引用其它博客'}
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
