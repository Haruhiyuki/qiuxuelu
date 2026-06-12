'use client';

// 知识图谱：以当前帖子为中心，画出与它有站内提及关系的 1 跳邻域子图（有向）。
// 自包含 SVG，无第三方依赖；确定性放射布局，悬停节点高亮其相连的边与邻居。
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { DocGraph, GraphNode } from '@/server/references';

const W = 460;
const H = 340;
const CX = W / 2;
const CY = H / 2;
const R = 128; // 邻居环半径

interface Placed extends GraphNode {
  x: number;
  y: number;
  r: number;
}

const RELATION_FILL: Record<GraphNode['relation'], string> = {
  center: 'var(--color-accent-600)',
  outgoing: 'var(--color-brand-500)',
  incoming: 'var(--color-moss-600)',
  both: 'var(--color-brand-700)',
};

const RELATION_LABEL: Record<GraphNode['relation'], string> = {
  center: '本帖',
  outgoing: '本帖提及',
  incoming: '提及本帖',
  both: '相互提及',
};

/** 截断标题，保留可读长度 */
function clip(s: string, n: number): string {
  return [...s].length > n ? `${[...s].slice(0, n).join('')}…` : s;
}

export function KnowledgeGraph({ graph }: { graph: DocGraph }) {
  const [hover, setHover] = useState<string | null>(null);

  const placed = useMemo<Placed[]>(() => {
    const center = graph.nodes.find((n) => n.relation === 'center');
    const others = graph.nodes.filter((n) => n.relation !== 'center');
    const out: Placed[] = [];
    if (center !== undefined) {
      out.push({ ...center, x: CX, y: CY, r: 26 });
    }
    // 邻居均匀分布在环上；从正上方起顺时针，避免与中心标签打架
    others.forEach((n, i) => {
      const angle = (i / Math.max(1, others.length)) * Math.PI * 2 - Math.PI / 2;
      out.push({
        ...n,
        x: CX + Math.cos(angle) * R,
        y: CY + Math.sin(angle) * R,
        r: 18,
      });
    });
    return out;
  }, [graph.nodes]);

  const posById = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);

  // 悬停某节点时，与之相连的边/节点高亮，其余淡出
  const connected = useMemo(() => {
    if (hover === null) {
      return null;
    }
    const set = new Set<string>([hover]);
    for (const e of graph.edges) {
      if (e.source === hover) {
        set.add(e.target);
      } else if (e.target === hover) {
        set.add(e.source);
      }
    }
    return set;
  }, [hover, graph.edges]);

  const dim = (id: string) => connected !== null && !connected.has(id);
  const edgeDim = (e: { source: string; target: string }) =>
    connected !== null &&
    !(
      connected.has(e.source) &&
      connected.has(e.target) &&
      (e.source === hover || e.target === hover)
    );

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full select-none"
      role="img"
      aria-label="本帖与相关帖子的提及关系图"
    >
      <defs>
        <marker
          id="kg-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="var(--color-ink-300)" />
        </marker>
      </defs>

      {/* 边（有向，从 source 指向 target） */}
      {graph.edges.map((e) => {
        const a = posById.get(e.source);
        const b = posById.get(e.target);
        if (a === undefined || b === undefined) {
          return null;
        }
        // 端点缩到节点边缘，让箭头不被圆盖住
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const x1 = a.x + ux * a.r;
        const y1 = a.y + uy * a.r;
        const x2 = b.x - ux * (b.r + 6);
        const y2 = b.y - uy * (b.r + 6);
        return (
          <line
            key={`${e.source}-${e.target}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="var(--color-ink-300)"
            strokeWidth={1.5}
            markerEnd="url(#kg-arrow)"
            className="transition-opacity duration-150"
            opacity={edgeDim(e) ? 0.15 : 0.7}
          />
        );
      })}

      {/* 节点 */}
      {placed.map((n) => (
        <Link
          key={n.id}
          href={`/a/${n.slug}`}
          aria-label={`${RELATION_LABEL[n.relation]}：${n.title}`}
          onMouseEnter={() => setHover(n.id)}
          onMouseLeave={() => setHover(null)}
        >
          <g
            className="cursor-pointer transition-opacity duration-150"
            opacity={dim(n.id) ? 0.25 : 1}
          >
            <circle
              cx={n.x}
              cy={n.y}
              r={n.r}
              fill={RELATION_FILL[n.relation]}
              stroke="var(--color-paper-50)"
              strokeWidth={2}
              className="transition-transform"
            />
            {n.relation === 'center' ? (
              <text
                x={n.x}
                y={n.y}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-[var(--color-on-fill)] font-serif"
                fontSize={11}
              >
                本帖
              </text>
            ) : null}
            {/* 标题标签在节点下方 */}
            <text
              x={n.x}
              y={n.y + n.r + 13}
              textAnchor="middle"
              className="fill-[var(--color-ink-700)]"
              fontSize={n.relation === 'center' ? 12 : 11}
              fontWeight={n.relation === 'center' ? 600 : 400}
            >
              {clip(n.title, n.relation === 'center' ? 14 : 11)}
            </text>
          </g>
        </Link>
      ))}
    </svg>
  );
}
