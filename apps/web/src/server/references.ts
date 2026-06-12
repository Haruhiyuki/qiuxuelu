// 站内提及图（知识图谱）：从已发布正文提取「链接到其它帖子」的有向边，并按帖子取邻域子图。
import {
  type Database,
  documentReferences,
  documents,
  getDb,
  publishedSnapshots,
} from '@harublog/db';
import { collectLinkHrefs, type DocJson, validateDoc } from '@harublog/kernel';
import { and, eq, inArray, ne } from 'drizzle-orm';

type Tx = Pick<Database, 'select' | 'insert' | 'delete'>;

/** 从 /a/<slug>[#...|?...|/...] 取出 slug；非站内文章链接返回 null。 */
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

/** 正文 → 去重的站内文章 slug 集合（指向其它帖子的提及）。content 容错（坏数据返回空）。 */
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

export interface GraphNode {
  id: string;
  slug: string;
  title: string;
  /** 与中心帖子的关系：center / outgoing(本帖提及它) / incoming(它提及本帖) / both */
  relation: 'center' | 'outgoing' | 'incoming' | 'both';
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface DocGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * 取某帖子的 1 跳邻域子图：中心 + 它提及的/提及它的已发布帖子，外加这些节点之间的全部有向边
 * （让它是真正的图而非星形）。无邻居时返回仅含中心的图（调用方据此决定是否展示）。
 */
export async function getDocGraph(db: Pick<Database, 'select'>, docId: string): Promise<DocGraph> {
  const [outRows, inRows, centerRow] = await Promise.all([
    db
      .select({ id: documents.id, slug: documents.slug, title: documents.title })
      .from(documentReferences)
      .innerJoin(documents, eq(documents.id, documentReferences.targetDocId))
      .innerJoin(publishedSnapshots, eq(publishedSnapshots.documentId, documents.id))
      .where(eq(documentReferences.sourceDocId, docId)),
    db
      .select({ id: documents.id, slug: documents.slug, title: documents.title })
      .from(documentReferences)
      .innerJoin(documents, eq(documents.id, documentReferences.sourceDocId))
      .innerJoin(publishedSnapshots, eq(publishedSnapshots.documentId, documents.id))
      .where(eq(documentReferences.targetDocId, docId)),
    db
      .select({ id: documents.id, slug: documents.slug, title: documents.title })
      .from(documents)
      .where(eq(documents.id, docId))
      .limit(1),
  ]);
  const center = centerRow[0];
  if (center === undefined) {
    return { nodes: [], edges: [] };
  }

  const outIds = new Set(outRows.map((r) => r.id));
  const inIds = new Set(inRows.map((r) => r.id));
  const byId = new Map<string, { id: string; slug: string; title: string }>();
  for (const r of [...outRows, ...inRows]) {
    byId.set(r.id, r);
  }

  const nodes: GraphNode[] = [
    { ...center, relation: 'center' },
    ...[...byId.values()].map((r) => {
      const isOut = outIds.has(r.id);
      const isIn = inIds.has(r.id);
      return {
        ...r,
        relation: (isOut && isIn
          ? 'both'
          : isOut
            ? 'outgoing'
            : 'incoming') as GraphNode['relation'],
      };
    }),
  ];

  if (nodes.length === 1) {
    return { nodes, edges: [] };
  }

  // 子图全部节点之间的有向边（含中心↔邻居 与 邻居↔邻居），让图更连通
  const idSet = new Set(nodes.map((n) => n.id));
  const ids = [...idSet];
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
  const edges = edgeRows.filter((e) => idSet.has(e.source) && idSet.has(e.target));
  return { nodes, edges };
}

/** 便捷：用全局 db 取图（页面读路径用）。 */
export function getDocGraphLive(docId: string): Promise<DocGraph> {
  return getDocGraph(getDb(), docId);
}
