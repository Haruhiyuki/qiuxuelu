'use server';

// 博客系列写路径（ADR-0014）：作者自归属编排——所有权直检（series.owner_id===actor.id），
// 不走 can()（系列非治理对象，与 reactions/account 同风格）；停用账号一律拒绝。
// 加入系列额外要求文档归属本人——只能编排自己的博客。
import { documents, getDb, series, seriesItems } from '@harublog/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';
import { loadActor } from '@/server/actors';
import { createDocument } from './document';

const uuid = z.uuid();
const titleSchema = z.string().trim().min(1, '系列名不能为空').max(80, '系列名最长 80 字');
const descSchema = z.string().trim().max(300, '系列简介最长 300 字');

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

async function requireActor() {
  const session = await getSession();
  if (!session) {
    return null;
  }
  return loadActor(session.user.id);
}

/** 取「归属当前用户」的系列；不存在或非本人返回 null。 */
async function loadOwnedSeries(seriesId: string, ownerId: string) {
  const rows = await getDb()
    .select({ id: series.id })
    .from(series)
    .where(and(eq(series.id, seriesId), eq(series.ownerId, ownerId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createSeries(
  rawTitle: string,
  rawDescription?: string,
): Promise<ActionResult<{ seriesId: string; slug: string }>> {
  const actor = await requireActor();
  if (!actor) {
    return fail('请先登录');
  }
  if (actor.status === 'suspended') {
    return fail('账号已被停用');
  }
  const title = titleSchema.safeParse(rawTitle);
  if (!title.success) {
    return fail(title.error.issues[0]?.message ?? '系列名校验失败');
  }
  let description: string | null = null;
  if (rawDescription !== undefined && rawDescription.trim().length > 0) {
    const d = descSchema.safeParse(rawDescription);
    if (!d.success) {
      return fail(d.error.issues[0]?.message ?? '系列简介校验失败');
    }
    description = d.data;
  }
  const slug = nanoid(10);
  try {
    const inserted = await getDb()
      .insert(series)
      .values({ ownerId: actor.id, slug, title: title.data, description })
      .returning({ id: series.id, slug: series.slug });
    const row = inserted[0];
    if (!row) {
      return fail('系列创建失败，请稍后重试');
    }
    return { ok: true, data: { seriesId: row.id, slug: row.slug } };
  } catch {
    return fail('系列创建失败，请稍后重试');
  }
}

export async function updateSeries(
  rawSeriesId: string,
  input: { title?: string; description?: string },
): Promise<ActionResult> {
  const actor = await requireActor();
  if (!actor) {
    return fail('请先登录');
  }
  if (!uuid.safeParse(rawSeriesId).success) {
    return fail('系列参数非法');
  }
  if ((await loadOwnedSeries(rawSeriesId, actor.id)) === null) {
    return fail('系列不存在或无权管理');
  }
  const patch: Partial<{ title: string; description: string | null }> = {};
  if (input.title !== undefined) {
    const t = titleSchema.safeParse(input.title);
    if (!t.success) {
      return fail(t.error.issues[0]?.message ?? '系列名校验失败');
    }
    patch.title = t.data;
  }
  if (input.description !== undefined) {
    const trimmed = input.description.trim();
    if (trimmed.length > 0) {
      const d = descSchema.safeParse(trimmed);
      if (!d.success) {
        return fail(d.error.issues[0]?.message ?? '系列简介校验失败');
      }
      patch.description = d.data;
    } else {
      patch.description = null;
    }
  }
  if (Object.keys(patch).length > 0) {
    await getDb()
      .update(series)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(series.id, rawSeriesId));
  }
  return { ok: true, data: null };
}

export async function deleteSeries(rawSeriesId: string): Promise<ActionResult> {
  const actor = await requireActor();
  if (!actor) {
    return fail('请先登录');
  }
  if (!uuid.safeParse(rawSeriesId).success) {
    return fail('系列参数非法');
  }
  if ((await loadOwnedSeries(rawSeriesId, actor.id)) === null) {
    return fail('系列不存在或无权管理');
  }
  // series_items 经外键级联随之删除（不删博客本身）
  await getDb().delete(series).where(eq(series.id, rawSeriesId));
  return { ok: true, data: null };
}

/** 把文档加入 / 移动到某系列；seriesId=null 表示移出当前系列。只能编排自己的博客。 */
export async function setDocumentSeries(
  rawDocId: string,
  rawSeriesId: string | null,
): Promise<ActionResult> {
  const actor = await requireActor();
  if (!actor) {
    return fail('请先登录');
  }
  if (actor.status === 'suspended') {
    return fail('账号已被停用');
  }
  if (!uuid.safeParse(rawDocId).success) {
    return fail('文档参数非法');
  }
  if (rawSeriesId !== null && !uuid.safeParse(rawSeriesId).success) {
    return fail('系列参数非法');
  }
  const db = getDb();
  const docRows = await db
    .select({ ownerId: documents.ownerId })
    .from(documents)
    .where(eq(documents.id, rawDocId))
    .limit(1);
  const doc = docRows[0];
  if (!doc) {
    return fail('博客不存在');
  }
  if (doc.ownerId !== actor.id) {
    return fail('只能把自己的博客加入系列');
  }

  if (rawSeriesId === null) {
    await db.delete(seriesItems).where(eq(seriesItems.documentId, rawDocId));
    return { ok: true, data: null };
  }
  if ((await loadOwnedSeries(rawSeriesId, actor.id)) === null) {
    return fail('系列不存在或无权管理');
  }
  // 已在目标系列：无操作
  const existing = await db
    .select({ seriesId: seriesItems.seriesId })
    .from(seriesItems)
    .where(eq(seriesItems.documentId, rawDocId))
    .limit(1);
  if (existing[0]?.seriesId === rawSeriesId) {
    return { ok: true, data: null };
  }
  const maxRows = await db
    .select({ maxPos: sql<number>`coalesce(max(${seriesItems.position}), -1)::int` })
    .from(seriesItems)
    .where(eq(seriesItems.seriesId, rawSeriesId));
  const nextPos = Number(maxRows[0]?.maxPos ?? -1) + 1;
  await db
    .insert(seriesItems)
    .values({ documentId: rawDocId, seriesId: rawSeriesId, position: nextPos })
    .onConflictDoUpdate({
      target: seriesItems.documentId,
      set: { seriesId: rawSeriesId, position: nextPos, addedAt: new Date() },
    });
  await db.update(series).set({ updatedAt: new Date() }).where(eq(series.id, rawSeriesId));
  return { ok: true, data: null };
}

/** 重排系列：传入期望的完整 docId 顺序，整体改写 position（缺失项补到末尾，未知项忽略）。 */
export async function reorderSeries(
  rawSeriesId: string,
  rawOrder: string[],
): Promise<ActionResult> {
  const actor = await requireActor();
  if (!actor) {
    return fail('请先登录');
  }
  if (!uuid.safeParse(rawSeriesId).success) {
    return fail('系列参数非法');
  }
  if (!Array.isArray(rawOrder) || rawOrder.some((id) => !uuid.safeParse(id).success)) {
    return fail('排序参数非法');
  }
  if ((await loadOwnedSeries(rawSeriesId, actor.id)) === null) {
    return fail('系列不存在或无权管理');
  }
  const db = getDb();
  const current = await db
    .select({ documentId: seriesItems.documentId })
    .from(seriesItems)
    .where(eq(seriesItems.seriesId, rawSeriesId))
    .orderBy(asc(seriesItems.position), asc(seriesItems.addedAt));
  const valid = new Set(current.map((c) => c.documentId));
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of rawOrder) {
    if (valid.has(id) && !seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  }
  // 排序里漏掉的现有条目补到末尾（容错于陈旧客户端）
  for (const c of current) {
    if (!seen.has(c.documentId)) {
      ordered.push(c.documentId);
    }
  }
  try {
    await db.transaction(async (tx) => {
      for (let i = 0; i < ordered.length; i++) {
        await tx
          .update(seriesItems)
          .set({ position: i })
          .where(eq(seriesItems.documentId, ordered[i] as string));
      }
      await tx.update(series).set({ updatedAt: new Date() }).where(eq(series.id, rawSeriesId));
    });
    return { ok: true, data: null };
  } catch {
    return fail('排序保存失败，请稍后重试');
  }
}

/** 在系列内新建博客：复用 createDocument（带 consent/can 闸）再加入系列。 */
export async function createDocumentInSeries(
  rawTitle: string,
  rawSectionId: string,
  rawSeriesId: string,
): Promise<ActionResult<{ docId: string }>> {
  const actor = await requireActor();
  if (!actor) {
    return fail('请先登录');
  }
  if (!uuid.safeParse(rawSeriesId).success) {
    return fail('系列参数非法');
  }
  if ((await loadOwnedSeries(rawSeriesId, actor.id)) === null) {
    return fail('系列不存在或无权管理');
  }
  const created = await createDocument(rawTitle, rawSectionId);
  if (!created.ok) {
    return created;
  }
  const docId = created.data.docId;
  const db = getDb();
  const maxRows = await db
    .select({ maxPos: sql<number>`coalesce(max(${seriesItems.position}), -1)::int` })
    .from(seriesItems)
    .where(eq(seriesItems.seriesId, rawSeriesId));
  const nextPos = Number(maxRows[0]?.maxPos ?? -1) + 1;
  await db
    .insert(seriesItems)
    .values({ documentId: docId, seriesId: rawSeriesId, position: nextPos })
    .onConflictDoUpdate({
      target: seriesItems.documentId,
      set: { seriesId: rawSeriesId, position: nextPos, addedAt: new Date() },
    });
  await db.update(series).set({ updatedAt: new Date() }).where(eq(series.id, rawSeriesId));
  return { ok: true, data: { docId } };
}
