'use server';

// 博客标签：作者或板块编辑可设置。整体替换式（传完整标签列表），按名称去重、即时建标签。
import { documents, documentTags, getDb, tags } from '@harublog/db';
import { can, type DocCtx } from '@harublog/domain';
import { eq, inArray } from 'drizzle-orm';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';
import { loadActor } from '@/server/actors';

const MAX_TAGS = 5;
const MAX_LEN = 24;

function normalize(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const n = raw.trim().slice(0, MAX_LEN);
    if (n.length > 0 && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
    if (out.length >= MAX_TAGS) {
      break;
    }
  }
  return out;
}

export async function setDocumentTags(docId: string, names: string[]): Promise<ActionResult> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: '请先登录' };
  }
  const actor = await loadActor(session.user.id);
  if (!actor) {
    return { ok: false, error: '账号状态异常，请重新登录' };
  }
  const db = getDb();
  const doc = (
    await db
      .select({
        sectionId: documents.sectionId,
        ownerId: documents.ownerId,
        editPolicy: documents.editPolicy,
        status: documents.status,
      })
      .from(documents)
      .where(eq(documents.id, docId))
      .limit(1)
  )[0];
  if (!doc) {
    return { ok: false, error: '博客不存在' };
  }
  const isOwner = doc.ownerId === actor.id;
  const allowed =
    isOwner ||
    can(actor, 'doc.edit_direct', {
      sectionId: doc.sectionId,
      doc: {
        id: docId,
        ownerId: doc.ownerId ?? '',
        editPolicy: doc.editPolicy as DocCtx['editPolicy'],
        status: doc.status as DocCtx['status'],
      },
    }).allow;
  if (!allowed) {
    return { ok: false, error: '无权编辑该博客的标签' };
  }

  const wanted = normalize(names);
  await db.transaction(async (tx) => {
    let tagIds: string[] = [];
    if (wanted.length > 0) {
      await tx
        .insert(tags)
        .values(wanted.map((name) => ({ name })))
        .onConflictDoNothing({ target: tags.name });
      const rows = await tx.select({ id: tags.id }).from(tags).where(inArray(tags.name, wanted));
      tagIds = rows.map((r) => r.id);
    }
    await tx.delete(documentTags).where(eq(documentTags.documentId, docId));
    if (tagIds.length > 0) {
      await tx
        .insert(documentTags)
        .values(tagIds.map((tagId) => ({ documentId: docId, tagId })))
        .onConflictDoNothing();
    }
  });
  return { ok: true, data: null };
}

/** 读取一篇文档的标签名（供编辑器初始化用）。 */
export async function getDocumentTags(docId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ name: tags.name })
    .from(documentTags)
    .innerJoin(tags, eq(tags.id, documentTags.tagId))
    .where(eq(documentTags.documentId, docId));
  return rows.map((r) => r.name);
}
