// 站内提及图（知识图谱）：从已发布正文提取「链接到其它帖子」的有向边，并按帖子取邻域子图。
import {
  type Database,
  documentReferences,
  documents,
  getDb,
  publishedSnapshots,
  user as userTable,
} from '@harublog/db';
import { collectLinkHrefs, type DocJson, validateDoc } from '@harublog/kernel';
import { and, eq, inArray, ne } from 'drizzle-orm';

type Tx = Pick<Database, 'select' | 'insert' | 'delete'>;

/** 从 /a/<slug>[#...|?...|/...] 取出 slug；非站内博客链接返回 null。 */
export function slugFromHref(href: string): string | null {
  const m = /^\/a\/([^/#?]+)/.exec(href.trim());
  if (m === null) {
    return null;
  }
  try {
    return decodeURIComponent(m[1] as string);
  } catch {
    return m[1] as string;
  }
}

/** 正文 → 去重的站内博客 slug 集合（指向其它帖子的提及）。content 容错（坏数据返回空）。 */
export function collectInternalSlugs(content: unknown): string[] {
  let doc: DocJson;
  try {
    doc = validateDoc(content);
  } catch {
    return [];
  }
  const slugs = new Set<string>();
  for (const href of collectLinkHrefs(doc)) {
    const slug = slugFromHref(href);
    if (slug !== null) {
      slugs.add(slug);
    }
  }
  return [...slugs];
}

/**
 * 重建某帖子的全部「出边」（source=docId）：解析正文里的站内链接 → 已发布的目标帖子，
 * 删旧出边、插新出边。幂等，可全量重算。在发布事务内调用（传 tx）。
 */
export async function recomputeReferences(tx: Tx, docId: string, content: unknown): Promise<void> {
  const slugs = collectInternalSlugs(content);
  await tx.delete(documentReferences).where(eq(documentReferences.sourceDocId, docId));
  if (slugs.length === 0) {
    return;
  }
  // 仅连向「已发布」的帖子（草稿/待审不进图）；排除自引用
  const targets = await tx
    .select({ id: documents.id })
    .from(documents)
    .innerJoin(publishedSnapshots, eq(publishedSnapshots.documentId, documents.id))
    .where(and(inArray(documents.slug, slugs), ne(documents.id, docId)));
  if (targets.length === 0) {
    return;
  }
  await tx
    .insert(documentReferences)
    .values(targets.map((t) => ({ sourceDocId: docId, targetDocId: t.id })))
    .onConflictDoNothing();
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface LayeredNode {
  id: string;
  slug: string;
  title: string;
  authorName: string | null;
  updatedAt: Date;
  /** 距中心的最短跳数：0=中心，1/2/3=第一/二/三层 */
  depth: number;
}

export interface LayeredGraph {
  centerId: string;
  /** 含中心（depth 0）在内的全部节点 */
  nodes: LayeredNode[];
  /** 节点集合内的全部有向边（source 提及 target） */
  edges: GraphEdge[];
  /** 因节点上限被截断（图过大）*/
  truncated: boolean;
}

/** 单次图谱节点上限：超过即停止扩层，避免超大帖网拖垮渲染 */
const MAX_GRAPH_NODES = 60;

/**
 * 以某帖为中心做 BFS，取最多 maxDepth 层（默认 3）的邻域子图。邻接按「提及」双向展开
 * （它提及的 + 提及它的，均限已发布帖子），节点带最短跳数 depth；最后补齐节点集合内的
 * 全部有向边，使其成为真正的图而非树。空邻域时只返回中心（调用方据此决定是否展示）。
 */
export async function getDocGraphLayered(
  db: Pick<Database, 'select'>,
  centerId: string,
  maxDepth = 3,
): Promise<LayeredGraph> {
  const nodeCols = {
    id: documents.id,
    slug: documents.slug,
    title: documents.title,
    authorName: userTable.name,
    updatedAt: documents.updatedAt,
  };
  const centerRow = await db
    .select(nodeCols)
    .from(documents)
    .leftJoin(userTable, eq(userTable.id, documents.ownerId))
    .where(eq(documents.id, centerId))
    .limit(1);
  const center = centerRow[0];
  if (center === undefined) {
    return { centerId, nodes: [], edges: [], truncated: false };
  }

  const seen = new Set<string>([center.id]);
  const nodes: LayeredNode[] = [{ ...center, depth: 0 }];
  let frontier = [center.id];
  let truncated = false;

  for (let d = 1; d <= maxDepth && frontier.length > 0 && !truncated; d++) {
    const [outRows, inRows] = await Promise.all([
      db
        .select(nodeCols)
        .from(documentReferences)
        .innerJoin(documents, eq(documents.id, documentReferences.targetDocId))
        .innerJoin(publishedSnapshots, eq(publishedSnapshots.documentId, documents.id))
        .leftJoin(userTable, eq(userTable.id, documents.ownerId))
        .where(inArray(documentReferences.sourceDocId, frontier)),
      db
        .select(nodeCols)
        .from(documentReferences)
        .innerJoin(documents, eq(documents.id, documentReferences.sourceDocId))
        .innerJoin(publishedSnapshots, eq(publishedSnapshots.documentId, documents.id))
        .leftJoin(userTable, eq(userTable.id, documents.ownerId))
        .where(inArray(documentReferences.targetDocId, frontier)),
    ]);
    const next: string[] = [];
    for (const r of [...outRows, ...inRows]) {
      if (seen.has(r.id)) {
        continue;
      }
      if (seen.size >= MAX_GRAPH_NODES) {
        truncated = true;
        break;
      }
      seen.add(r.id);
      nodes.push({ ...r, depth: d });
      next.push(r.id);
    }
    frontier = next;
  }

  let edges: GraphEdge[] = [];
  if (nodes.length > 1) {
    const ids = nodes.map((n) => n.id);
    const idSet = new Set(ids);
    const edgeRows = await db
      .select({
        source: documentReferences.sourceDocId,
        target: documentReferences.targetDocId,
      })
      .from(documentReferences)
      .where(
        and(
          inArray(documentReferences.sourceDocId, ids),
          inArray(documentReferences.targetDocId, ids),
        ),
      );
    edges = edgeRows.filter((e) => idSet.has(e.source) && idSet.has(e.target));
  }

  return { centerId: center.id, nodes, edges, truncated };
}

/** 便捷：用全局 db 取分层图（页面读路径用）。 */
export function getDocGraphLayeredLive(docId: string, maxDepth = 3): Promise<LayeredGraph> {
  return getDocGraphLayered(getDb(), docId, maxDepth);
}
