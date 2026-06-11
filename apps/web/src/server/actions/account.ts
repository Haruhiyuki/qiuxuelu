'use server';

// 账户自助：仅改本人记录，无需 can()（非治理操作，作用域限定自身）。
import { getDb, user as userTable } from '@harublog/db';
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
