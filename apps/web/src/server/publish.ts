// 发布核心（事务内）：移动 published ref + 重建快照 + 置 published + 重算引用 + 订阅通知 +
// 搜索 outbox + 信任事件。供「编辑审批通过」(review.ts) 与「T2+ 免预审直接发布」(document.ts)
// 复用同一套副作用，避免两条路径行为漂移（ADR-0010）。
import {
  auditLog,
  documentRefs,
  documents,
  type getDb,
  publishedSnapshots,
  searchOutbox,
  sections,
  subscriptions,
} from '@harublog/db';
import { validateDoc } from '@harublog/kernel';
import { eq } from 'drizzle-orm';
import { insertNotification } from './notifications';
import { recomputeReferences } from './references';
import { loadRevisionDoc } from './revision-doc';
import { emitTrustEvent, recomputeTrust } from './trust';

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

export interface PublishParams {
  documentId: string;
  revisionId: string;
  sectionId: string;
  /** 作者/请求者：记信任 + 板块订阅 new_post 的 actor；可空（佚名历史数据） */
  authorId: string | null;
  /** 实际执行发布者：写入快照 approvedBy 与审计 actor */
  approverId: string;
  slug: string;
  title: string;
  auditAction: string;
  /** 审批通过时通知作者；自助直接发布时为 false（不给自己发） */
  notifyAuthor: boolean;
}

/** 把某修订发布为文档线上版（幂等：published ref / 快照都 upsert）。在外层事务内调用。 */
export async function publishRevisionTx(tx: Tx, p: PublishParams): Promise<void> {
  const now = new Date();

  // published ref 指向被发布的精确修订
  await tx
    .insert(documentRefs)
    .values({ documentId: p.documentId, name: 'published', revisionId: p.revisionId })
    .onConflictDoUpdate({
      target: [documentRefs.documentId, documentRefs.name],
      set: { revisionId: p.revisionId, updatedAt: now },
    });

  // 树表是真相，快照是发布事务内重建的读缓存；落库前必过 kernel 校验
  const docJson = validateDoc(await loadRevisionDoc(tx, p.revisionId));
  await tx
    .insert(publishedSnapshots)
    .values({
      documentId: p.documentId,
      revisionId: p.revisionId,
      content: docJson,
      approvedBy: p.approverId,
      publishedAt: now,
    })
    .onConflictDoUpdate({
      target: publishedSnapshots.documentId,
      set: {
        revisionId: p.revisionId,
        content: docJson,
        approvedBy: p.approverId,
        publishedAt: now,
      },
    });

  await tx
    .update(documents)
    .set({ status: 'published', updatedAt: now })
    .where(eq(documents.id, p.documentId));

  // 知识图谱：据新发布正文重建本帖出边
  await recomputeReferences(tx, p.documentId, docJson);

  await tx.insert(auditLog).values({
    actorId: p.approverId,
    action: p.auditAction,
    subjectType: 'document',
    subjectId: p.documentId,
    sectionId: p.sectionId,
    detail: { revisionId: p.revisionId },
  });

  if (p.notifyAuthor && p.authorId !== null) {
    await insertNotification(tx, {
      recipientId: p.authorId,
      actorId: p.approverId,
      kind: 'publish_approved',
      payload: { docId: p.documentId, slug: p.slug, title: p.title },
    });
  }

  // 板块订阅者：发「板块有新文章」（actor=作者 → 作者自己订阅会自动跳过）
  const subs = await tx
    .select({ userId: subscriptions.userId, token: subscriptions.token })
    .from(subscriptions)
    .where(eq(subscriptions.sectionId, p.sectionId));
  if (subs.length > 0) {
    const sectionRow = await tx
      .select({ name: sections.name })
      .from(sections)
      .where(eq(sections.id, p.sectionId))
      .limit(1);
    const sectionName = sectionRow[0]?.name ?? '';
    for (const s of subs) {
      await insertNotification(tx, {
        recipientId: s.userId,
        actorId: p.authorId ?? p.approverId,
        kind: 'new_post',
        payload: { slug: p.slug, title: p.title, sectionName, unsubToken: s.token },
      });
    }
  }

  // 事务性 outbox：worker 异步推 Meilisearch
  await tx
    .insert(searchOutbox)
    .values({ topic: 'doc.published', payload: { docId: p.documentId } });

  // 信任：作者文章发布，记事件并重算（发首文即达 T1）
  if (p.authorId !== null) {
    await emitTrustEvent(tx, {
      userId: p.authorId,
      kind: 'doc_published',
      refType: 'document',
      refId: p.documentId,
    });
    await recomputeTrust(tx, p.authorId);
  }
}
