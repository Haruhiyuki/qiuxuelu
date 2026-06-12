'use server';

// 站点公告管理（管理员+）：先 can('announcement.manage') 再干活，写审计。近闻页 + 首页公告栏的数据来源。
import { announcements, auditLog, getDb } from '@harublog/db';
import { can, explainDeny } from '@harublog/domain';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';
import { loadActor } from '@/server/actors';

const uuid = z.uuid();

const inputSchema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(120, '标题最长 120 字'),
  body: z.string().trim().min(1, '内容不能为空').max(2000, '内容最长 2000 字'),
  level: z.enum(['info', 'notice']),
  pinned: z.boolean(),
  // 链接选填：站内路径或 http(s) 外链；与渲染器同款安全门
  linkHref: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v.length === 0 || /^(https?:\/\/|\/)/.test(v), '链接需为 http(s) 或站内路径')
    .optional(),
  linkLabel: z.string().trim().max(40).optional(),
});

export type AnnouncementInput = z.infer<typeof inputSchema>;

type ManagerAuth = { ok: false; error: string } | { ok: true; actorId: string };

async function requireManager(): Promise<ManagerAuth> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: '请先登录' };
  }
  const actor = await loadActor(session.user.id);
  if (!actor) {
    return { ok: false, error: '账号状态异常，请重新登录' };
  }
  const decision = can(actor, 'announcement.manage', {});
  if (!decision.allow) {
    return { ok: false, error: explainDeny(decision.reason) };
  }
  return { ok: true, actorId: actor.id };
}

export async function createAnnouncement(
  input: AnnouncementInput,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireManager();
  if (!auth.ok) {
    return { ok: false, error: auth.error };
  }
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '校验失败' };
  }
  const { title, body, level, pinned, linkHref, linkLabel } = parsed.data;
  const db = getDb();
  const now = new Date();
  const inserted = await db
    .insert(announcements)
    .values({
      title,
      body,
      level,
      pinned,
      linkHref: linkHref && linkHref.length > 0 ? linkHref : null,
      linkLabel: linkLabel && linkLabel.length > 0 ? linkLabel : null,
      authorId: auth.actorId,
      status: 'published',
      publishedAt: now,
    })
    .returning({ id: announcements.id });
  const id = inserted[0]?.id;
  if (id === undefined) {
    return { ok: false, error: '发布失败，请稍后重试' };
  }
  await db.insert(auditLog).values({
    actorId: auth.actorId,
    action: 'announcement.create',
    subjectType: 'announcement',
    subjectId: id,
    detail: { title, level, pinned },
  });
  return { ok: true, data: { id } };
}

export async function updateAnnouncement(
  rawId: string,
  input: AnnouncementInput,
): Promise<ActionResult> {
  const auth = await requireManager();
  if (!auth.ok) {
    return { ok: false, error: auth.error };
  }
  if (!uuid.safeParse(rawId).success) {
    return { ok: false, error: '参数非法' };
  }
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '校验失败' };
  }
  const { title, body, level, pinned, linkHref, linkLabel } = parsed.data;
  const db = getDb();
  await db
    .update(announcements)
    .set({
      title,
      body,
      level,
      pinned,
      linkHref: linkHref && linkHref.length > 0 ? linkHref : null,
      linkLabel: linkLabel && linkLabel.length > 0 ? linkLabel : null,
      updatedAt: new Date(),
    })
    .where(eq(announcements.id, rawId));
  await db.insert(auditLog).values({
    actorId: auth.actorId,
    action: 'announcement.update',
    subjectType: 'announcement',
    subjectId: rawId,
    detail: { title, level, pinned },
  });
  return { ok: true, data: null };
}

/** 切换置顶（首页公告栏） */
export async function setAnnouncementPinned(rawId: string, pinned: boolean): Promise<ActionResult> {
  const auth = await requireManager();
  if (!auth.ok) {
    return { ok: false, error: auth.error };
  }
  if (!uuid.safeParse(rawId).success) {
    return { ok: false, error: '参数非法' };
  }
  await getDb()
    .update(announcements)
    .set({ pinned, updatedAt: new Date() })
    .where(eq(announcements.id, rawId));
  return { ok: true, data: null };
}

/** 下线（archived）或重新发布（published） */
export async function setAnnouncementStatus(rawId: string, status: string): Promise<ActionResult> {
  const auth = await requireManager();
  if (!auth.ok) {
    return { ok: false, error: auth.error };
  }
  if (!uuid.safeParse(rawId).success) {
    return { ok: false, error: '参数非法' };
  }
  if (status !== 'published' && status !== 'archived') {
    return { ok: false, error: '非法状态' };
  }
  const db = getDb();
  await db
    .update(announcements)
    .set({ status, ...(status === 'archived' ? { pinned: false } : {}), updatedAt: new Date() })
    .where(eq(announcements.id, rawId));
  await db.insert(auditLog).values({
    actorId: auth.actorId,
    action: 'announcement.status',
    subjectType: 'announcement',
    subjectId: rawId,
    detail: { status },
  });
  return { ok: true, data: null };
}
