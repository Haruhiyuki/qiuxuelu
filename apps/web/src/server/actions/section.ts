'use server';

// 板块管理（section.manage，admin+）：新建 / 重命名 / 移动文章所属板块 / 删除（需空）/ 调整顺序。
// 高危治理操作，全部经 can() 鉴权并写 audit_log。slug 用于 /?section=<slug> 筛选。
import {
  auditLog,
  documents,
  getDb,
  reviewItems,
  roleGrants,
  sanctions,
  searchOutbox,
  sections,
} from '@harublog/db';
import { can } from '@harublog/domain';
import { asc, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';
import { loadActor } from '@/server/actors';

const uuid = z.uuid();
const nameSchema = z.string().trim().min(1, '板块名不能为空').max(20, '板块名最长 20 字');
const slugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9-]{2,40}$/, 'slug 仅限小写字母、数字、连字符（2–40 位）');
const descSchema = z.string().trim().max(200, '简介最长 200 字');

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function isUniqueViolation(err: unknown): boolean {
  for (let e = err; typeof e === 'object' && e !== null; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: string }).code === '23505') {
      return true;
    }
  }
  return false;
}

/** 校验管理者身份：登录 + admin+（section.manage 红线能力）。 */
async function requireManager() {
  const session = await getSession();
  if (!session) {
    return null;
  }
  const actor = await loadActor(session.user.id);
  if (actor === null || !can(actor, 'section.manage', {}).allow) {
    return null;
  }
  return actor;
}

export async function createSection(
  rawName: string,
  rawSlug?: string,
  rawDescription?: string,
): Promise<ActionResult<{ sectionId: string }>> {
  const actor = await requireManager();
  if (!actor) {
    return fail('需要管理员权限');
  }
  const name = nameSchema.safeParse(rawName);
  if (!name.success) {
    return fail(name.error.issues[0]?.message ?? '板块名校验失败');
  }
  let slug: string;
  if (rawSlug !== undefined && rawSlug.trim().length > 0) {
    const s = slugSchema.safeParse(rawSlug);
    if (!s.success) {
      return fail(s.error.issues[0]?.message ?? 'slug 校验失败');
    }
    slug = s.data;
  } else {
    // 中文板块名无法直接做 slug，缺省生成短 id
    slug = `sec-${nanoid(8).toLowerCase()}`;
  }
  let description: string | null = null;
  if (rawDescription !== undefined && rawDescription.trim().length > 0) {
    const d = descSchema.safeParse(rawDescription);
    if (!d.success) {
      return fail(d.error.issues[0]?.message ?? '简介校验失败');
    }
    description = d.data;
  }
  const db = getDb();
  const maxRows = await db
    .select({ maxPos: sql<number>`coalesce(max(${sections.position}), -1)::int` })
    .from(sections);
  const nextPos = Number(maxRows[0]?.maxPos ?? -1) + 1;
  try {
    const inserted = await db
      .insert(sections)
      // stage 已退化为内部字段（不展示）：新板块统一记 general，满足 CHECK
      .values({ slug, name: name.data, description, stage: 'general', position: nextPos })
      .returning({ id: sections.id });
    const row = inserted[0];
    if (!row) {
      return fail('板块创建失败，请稍后重试');
    }
    await db.insert(auditLog).values({
      actorId: actor.id,
      action: 'section.create',
      subjectType: 'section',
      subjectId: row.id,
      sectionId: row.id,
      detail: { name: name.data, slug },
    });
    return { ok: true, data: { sectionId: row.id } };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return fail('该 slug 已被占用，请换一个');
    }
    return fail('板块创建失败，请稍后重试');
  }
}

export async function renameSection(
  rawSectionId: string,
  input: { name?: string; slug?: string; description?: string },
): Promise<ActionResult> {
  const actor = await requireManager();
  if (!actor) {
    return fail('需要管理员权限');
  }
  if (!uuid.safeParse(rawSectionId).success) {
    return fail('板块参数非法');
  }
  const patch: Partial<{ name: string; slug: string; description: string | null }> = {};
  if (input.name !== undefined) {
    const n = nameSchema.safeParse(input.name);
    if (!n.success) {
      return fail(n.error.issues[0]?.message ?? '板块名校验失败');
    }
    patch.name = n.data;
  }
  if (input.slug !== undefined) {
    const s = slugSchema.safeParse(input.slug);
    if (!s.success) {
      return fail(s.error.issues[0]?.message ?? 'slug 校验失败');
    }
    patch.slug = s.data;
  }
  if (input.description !== undefined) {
    const trimmed = input.description.trim();
    if (trimmed.length > 0) {
      const d = descSchema.safeParse(trimmed);
      if (!d.success) {
        return fail(d.error.issues[0]?.message ?? '简介校验失败');
      }
      patch.description = d.data;
    } else {
      patch.description = null;
    }
  }
  if (Object.keys(patch).length === 0) {
    return { ok: true, data: null };
  }
  const db = getDb();
  try {
    await db.update(sections).set(patch).where(eq(sections.id, rawSectionId));
    await db.insert(auditLog).values({
      actorId: actor.id,
      action: 'section.update',
      subjectType: 'section',
      subjectId: rawSectionId,
      sectionId: rawSectionId,
      detail: patch,
    });
    return { ok: true, data: null };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return fail('该 slug 已被占用，请换一个');
    }
    return fail('板块更新失败，请稍后重试');
  }
}

/** 把单篇文章移到另一板块；已发布文章重新入队搜索同步（板块名/slug 进索引）。 */
export async function moveDocumentSection(
  rawDocId: string,
  rawSectionId: string,
): Promise<ActionResult> {
  const actor = await requireManager();
  if (!actor) {
    return fail('需要管理员权限');
  }
  if (!uuid.safeParse(rawDocId).success || !uuid.safeParse(rawSectionId).success) {
    return fail('参数非法');
  }
  const db = getDb();
  const target = await db
    .select({ id: sections.id })
    .from(sections)
    .where(eq(sections.id, rawSectionId))
    .limit(1);
  if (!target[0]) {
    return fail('目标板块不存在');
  }
  const docRows = await db
    .select({ id: documents.id, status: documents.status })
    .from(documents)
    .where(eq(documents.id, rawDocId))
    .limit(1);
  const doc = docRows[0];
  if (!doc) {
    return fail('文章不存在');
  }
  await db.transaction(async (tx) => {
    await tx
      .update(documents)
      .set({ sectionId: rawSectionId, updatedAt: new Date() })
      .where(eq(documents.id, rawDocId));
    // 已发布：板块名/slug 进搜索索引，重新入队同步
    if (doc.status === 'published') {
      await tx
        .insert(searchOutbox)
        .values({ topic: 'doc.published', payload: { docId: rawDocId } });
    }
    await tx.insert(auditLog).values({
      actorId: actor.id,
      action: 'doc.move_section',
      subjectType: 'document',
      subjectId: rawDocId,
      sectionId: rawSectionId,
      detail: { toSection: rawSectionId },
    });
  });
  return { ok: true, data: null };
}

/** 删除板块：必须先移走全部文章；分离治理引用（置空）、订阅经外键级联随之删除。 */
export async function deleteSection(rawSectionId: string): Promise<ActionResult> {
  const actor = await requireManager();
  if (!actor) {
    return fail('需要管理员权限');
  }
  if (!uuid.safeParse(rawSectionId).success) {
    return fail('板块参数非法');
  }
  const db = getDb();
  const cntRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(documents)
    .where(eq(documents.sectionId, rawSectionId));
  const docCount = Number(cntRows[0]?.n ?? 0);
  if (docCount > 0) {
    return fail(`板块下还有 ${docCount} 篇文章，请先移到其它板块再删除`);
  }
  const nameRows = await db
    .select({ name: sections.name })
    .from(sections)
    .where(eq(sections.id, rawSectionId))
    .limit(1);
  if (!nameRows[0]) {
    return fail('板块不存在');
  }
  try {
    await db.transaction(async (tx) => {
      // 治理记录的板块作用域置空（不删历史）；订阅按外键级联随板块删除
      await tx
        .update(sanctions)
        .set({ sectionId: null })
        .where(eq(sanctions.sectionId, rawSectionId));
      await tx
        .update(reviewItems)
        .set({ sectionId: null })
        .where(eq(reviewItems.sectionId, rawSectionId));
      await tx
        .update(roleGrants)
        .set({ sectionId: null })
        .where(eq(roleGrants.sectionId, rawSectionId));
      await tx
        .update(auditLog)
        .set({ sectionId: null })
        .where(eq(auditLog.sectionId, rawSectionId));
      // 删除前先记审计（sectionId 留空，避免引用即将删除的行）
      await tx.insert(auditLog).values({
        actorId: actor.id,
        action: 'section.delete',
        subjectType: 'section',
        subjectId: rawSectionId,
        detail: { name: nameRows[0]?.name ?? '' },
      });
      await tx.delete(sections).where(eq(sections.id, rawSectionId));
    });
    return { ok: true, data: null };
  } catch {
    return fail('板块删除失败：可能仍被其它数据引用');
  }
}

export async function reorderSections(rawOrder: string[]): Promise<ActionResult> {
  const actor = await requireManager();
  if (!actor) {
    return fail('需要管理员权限');
  }
  if (!Array.isArray(rawOrder) || rawOrder.some((id) => !uuid.safeParse(id).success)) {
    return fail('排序参数非法');
  }
  const db = getDb();
  const current = await db
    .select({ id: sections.id })
    .from(sections)
    .orderBy(asc(sections.position));
  const valid = new Set(current.map((c) => c.id));
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of rawOrder) {
    if (valid.has(id) && !seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  }
  for (const c of current) {
    if (!seen.has(c.id)) {
      ordered.push(c.id);
    }
  }
  try {
    await db.transaction(async (tx) => {
      for (let i = 0; i < ordered.length; i++) {
        await tx
          .update(sections)
          .set({ position: i })
          .where(eq(sections.id, ordered[i] as string));
      }
    });
    return { ok: true, data: null };
  } catch {
    return fail('排序保存失败，请稍后重试');
  }
}
