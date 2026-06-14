'use server';

// 账户自助：仅改本人记录，无需 can()（非治理操作，作用域限定自身）。
import {
  account as accountTable,
  auditLog,
  getDb,
  session as sessionTable,
  userNameHistory,
  user as userTable,
} from '@harublog/db';
import { and, count, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { EDUCATION_STAGES, type EducationEntry, sortEducation } from '@/lib/education';
import { validateName } from '@/lib/identity';
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

const educationEntrySchema = z.object({
  stage: z.enum(EDUCATION_STAGES),
  school: z.string().trim().min(1, '请填写学校').max(100, '学校名最长 100 字'),
  field: z.string().trim().max(100, '专业/方向最长 100 字').optional(),
});

const profileSchema = z.object({
  bio: z.string().trim().max(280, '简介最长 280 字').optional(),
  education: z.array(educationEntrySchema).max(10, '最多 10 条教育经历').optional(),
  image: z.string().trim().max(500).optional(),
});

/** 更新本人公开资料：简介 / 教育经历 / 头像（头像 url 来自媒体上传）。 */
export async function updateProfile(input: {
  bio?: string;
  education?: EducationEntry[];
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
  const { bio, education, image } = parsed.data;
  const patch: Partial<{
    bio: string | null;
    education: EducationEntry[] | null;
    educationStage: string | null;
    image: string;
  }> = {};
  if (bio !== undefined) {
    patch.bio = bio.length > 0 ? bio : null;
  }
  if (education !== undefined) {
    // 去掉没填学校的空行 → 归一字段 → 按学历阶段排序；写新结构同时清退旧单字段
    const cleaned = sortEducation(
      education
        .filter((e) => e.school.trim().length > 0)
        .map((e) => ({
          stage: e.stage,
          school: e.school.trim(),
          ...(e.field && e.field.trim().length > 0 ? { field: e.field.trim() } : {}),
        })),
    );
    patch.education = cleaned.length > 0 ? cleaned : null;
    patch.educationStage = null;
  }
  if (image !== undefined && image.length > 0) {
    patch.image = image;
  }
  if (Object.keys(patch).length > 0) {
    await getDb().update(userTable).set(patch).where(eq(userTable.id, session.user.id));
  }
  return { ok: true, data: null };
}

/** 改名滚动窗口（天）与窗口内上限 */
const RENAME_WINDOW_DAYS = 7;
const RENAME_LIMIT = 2;
const MS_PER_DAY = 86_400_000;

/** 查询窗口内剩余改名次数（账户设置页展示用）。 */
export async function getRenameQuota(): Promise<
  ActionResult<{ remaining: number; limit: number; windowDays: number }>
> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: '请先登录' };
  }
  const windowStart = new Date(Date.now() - RENAME_WINDOW_DAYS * MS_PER_DAY);
  const rows = await getDb()
    .select({ n: count() })
    .from(userNameHistory)
    .where(
      and(eq(userNameHistory.userId, session.user.id), gte(userNameHistory.changedAt, windowStart)),
    );
  const used = Number(rows[0]?.n ?? 0);
  return {
    ok: true,
    data: {
      remaining: Math.max(0, RENAME_LIMIT - used),
      limit: RENAME_LIMIT,
      windowDays: RENAME_WINDOW_DAYS,
    },
  };
}

/**
 * 改名（name 是统一身份：署名 = @提及句柄）：
 * 校验格式 → 唯一性（小写比较，排除自己）→ 7 天窗口限频 → 事务内留痕旧名 + 更新。
 * 旧名进 user_name_history，旧 @提及 据此重定向到 user.id（隐藏稳定标识符）。
 */
export async function renameUser(raw: string): Promise<ActionResult<{ name: string }>> {
  const session = await getSession();
  if (!session) {
    return { ok: false, error: '请先登录' };
  }
  const name = raw.trim();
  const formatError = validateName(name);
  if (formatError !== null) {
    return { ok: false, error: formatError };
  }
  if (name === session.user.name) {
    return { ok: true, data: { name } };
  }
  const db = getDb();
  const uid = session.user.id;

  // 唯一性（大小写不敏感；同名仅大小写变化的「自改」放行，不计入限频之外的占用）
  const taken = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(and(inArray(sql`lower(${userTable.name})`, [name.toLowerCase()]), ne(userTable.id, uid)))
    .limit(1);
  if (taken.length > 0) {
    return { ok: false, error: '这个名字已被使用，换一个试试' };
  }

  try {
    const newName = await db.transaction(async (tx) => {
      // 限频在事务内复核，防并发连点绕过
      const windowStart = new Date(Date.now() - RENAME_WINDOW_DAYS * MS_PER_DAY);
      const used = await tx
        .select({ n: count() })
        .from(userNameHistory)
        .where(and(eq(userNameHistory.userId, uid), gte(userNameHistory.changedAt, windowStart)));
      if (Number(used[0]?.n ?? 0) >= RENAME_LIMIT) {
        throw new Error(`${RENAME_WINDOW_DAYS} 天内最多改名 ${RENAME_LIMIT} 次，请稍后再试`);
      }
      const current = await tx
        .select({ name: userTable.name })
        .from(userTable)
        .where(eq(userTable.id, uid))
        .limit(1);
      const oldName = current[0]?.name ?? session.user.name;
      await tx.insert(userNameHistory).values({ userId: uid, oldName });
      await tx.update(userTable).set({ name, updatedAt: new Date() }).where(eq(userTable.id, uid));
      return name;
    });
    return { ok: true, data: { name: newName } };
  } catch (err) {
    // 唯一索引兜底（并发抢名）与限频错误统一回中文
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('user_name_lower_uq')) {
      return { ok: false, error: '这个名字刚被别人抢先使用了，换一个试试' };
    }
    return {
      ok: false,
      error: msg.length > 0 && /[一-鿿]/.test(msg) ? msg : '改名失败，请稍后重试',
    };
  }
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
        // name 全站唯一：注销名带 id 片段避免互撞（展示上仍以「已注销」开头）
        name: `已注销-${uid.slice(0, 8)}`,
        email: `deleted+${uid}@deleted.local`,
        emailVerified: false,
        image: null,
        bio: null,
        educationStage: null,
        education: null,
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
