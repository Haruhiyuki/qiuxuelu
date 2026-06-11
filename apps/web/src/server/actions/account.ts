'use server';

// 账户自助：仅改本人记录，无需 can()（非治理操作，作用域限定自身）。
import {
  account as accountTable,
  auditLog,
  getDb,
  session as sessionTable,
  user as userTable,
} from '@harublog/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';

export async function setEmailNotifications(enabled: boolean): Promise<ActionResult> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: '请先登录' };
  }
  await getDb()
    .update(userTable)
    .set({ emailNotifications: enabled })
    .where(eq(userTable.id, session.user.id));
  return { ok: true, data: null };
}

const EDUCATION_STAGES = ['初中', '高中', '大学', '毕业', '其他'] as const;

const profileSchema = z.object({
  bio: z.string().trim().max(280, '简介最长 280 字').optional(),
  educationStage: z.enum(EDUCATION_STAGES).or(z.literal('')).optional(),
  image: z.string().trim().max(500).optional(),
});

/** 更新本人公开资料：简介 / 教育阶段 / 头像（头像 url 来自媒体上传）。 */
export async function updateProfile(input: {
  bio?: string;
  educationStage?: string;
  image?: string;
}): Promise<ActionResult> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: '请先登录' };
  }
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '资料校验失败' };
  }
  const { bio, educationStage, image } = parsed.data;
  const patch: Partial<{ bio: string | null; educationStage: string | null; image: string }> = {};
  if (bio !== undefined) {
    patch.bio = bio.length > 0 ? bio : null;
  }
  if (educationStage !== undefined) {
    patch.educationStage = educationStage.length > 0 ? educationStage : null;
  }
  if (image !== undefined && image.length > 0) {
    patch.image = image;
  }
  if (Object.keys(patch).length > 0) {
    await getDb().update(userTable).set(patch).where(eq(userTable.id, session.user.id));
  }
  return { ok: true, data: null };
}

const usernameSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_]{3,20}$/, '用户名为 3–20 位字母、数字或下划线');

/** 设置/清空用户名（@提及的唯一标识）：空字符串=清空；校验格式 + 唯一性（排除自己）。 */
export async function setUsername(raw: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: '请先登录' };
  }
  const db = getDb();
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    await db.update(userTable).set({ username: null }).where(eq(userTable.id, session.user.id));
    return { ok: true, data: null };
  }
  const parsed = usernameSchema.safeParse(trimmed);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '用户名非法' };
  }
  const taken = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.username, parsed.data))
    .limit(1);
  if (taken[0] !== undefined && taken[0].id !== session.user.id) {
    return { ok: false, error: '该用户名已被占用' };
  }
  await db
    .update(userTable)
    .set({ username: parsed.data })
    .where(eq(userTable.id, session.user.id));
  return { ok: true, data: null };
}

/**
 * 注销账号（软删 + 匿名化）：保留内容与修订署名（显示为「已注销用户」），但清除 PII、
 * 失效会话与登录凭证、停用账号、不可再登录。需前端二次确认。不硬删——外键与贡献历史不破坏。
 */
export async function deleteMyAccount(confirmText: string): Promise<ActionResult> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: '请先登录' };
  }
  if (confirmText.trim() !== '注销') {
    return { ok: false, error: '请输入「注销」以确认' };
  }
  const uid = session.user.id;
  const db = getDb();
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(userTable)
      .set({
        name: '已注销用户',
        email: `deleted+${uid}@deleted.local`,
        emailVerified: false,
        image: null,
        bio: null,
        educationStage: null,
        username: null,
        status: 'suspended',
        deletedAt: now,
      })
      .where(eq(userTable.id, uid));
    // 失效会话 + 删除登录凭证（密码/OAuth），彻底断登录
    await tx.delete(sessionTable).where(eq(sessionTable.userId, uid));
    await tx.delete(accountTable).where(eq(accountTable.userId, uid));
    await tx.insert(auditLog).values({
      actorId: uid,
      action: 'user.self_delete',
      subjectType: 'user',
      subjectId: uid,
      detail: { via: 'self-service', anonymized: true },
    });
  });
  return { ok: true, data: null };
}
