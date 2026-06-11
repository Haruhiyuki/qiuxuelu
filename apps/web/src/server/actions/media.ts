'use server';

// 媒体上传（红线：先 can('media.upload') 再干活；剥 EXIF 防地理隐私泄露；内容寻址去重）。
// 一律转码为 webp（含动图），统一出口、压缩体积、抹除元数据；私有桶经 /api/media 同源代理读取。
import { createHash } from 'node:crypto';
import { getDb, media } from '@harublog/db';
import { can, explainDeny } from '@harublog/domain';
import sharp from 'sharp';
import { getSession } from '@/lib/session';
import type { ActionResult } from '@/server/action-result';
import { loadActor } from '@/server/actors';
import { putObject } from '@/server/storage';

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const ALLOWED_INPUT = new Set(['jpeg', 'png', 'webp', 'gif']);
// 响应式派生宽度（与 /api/media 白名单、渲染器 srcset 一致）
const RESPONSIVE_WIDTHS = [400, 800, 1600];
const MAX_BYTES = Number(process.env.MEDIA_MAX_BYTES ?? 10 * 1024 * 1024);

export interface UploadedMedia {
  url: string;
  width: number;
  height: number;
}

export async function uploadMedia(formData: FormData): Promise<ActionResult<UploadedMedia>> {
  const session = await getSession();
  if (!session) {
    return fail('请先登录');
  }
  const actor = await loadActor(session.user.id);
  if (!actor) {
    return fail('账号状态异常，请重新登录');
  }
  // 唯一鉴权入口：media.upload（TL1+，no_edit/suspend 制裁封锁）
  const decision = can(actor, 'media.upload');
  if (!decision.allow) {
    return fail(explainDeny(decision.reason));
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return fail('未收到文件');
  }
  if (file.size > MAX_BYTES) {
    return fail(`文件过大（上限 ${Math.floor(MAX_BYTES / 1024 / 1024)}MB）`);
  }
  const input = Buffer.from(await file.arrayBuffer());

  let out: Buffer;
  let width: number;
  let height: number;
  try {
    const pipeline = sharp(input, { animated: true });
    const meta = await pipeline.metadata();
    if (meta.format === undefined || !ALLOWED_INPUT.has(meta.format)) {
      return fail('仅支持 JPEG / PNG / WebP / GIF 图片');
    }
    // rotate() 落实 EXIF 方向后输出；sharp 默认丢弃元数据（含 GPS/EXIF），实现隐私剥离
    out = await sharp(input, { animated: true }).rotate().webp({ quality: 82 }).toBuffer();
    const outMeta = await sharp(out, { animated: true }).metadata();
    width = outMeta.width ?? 0;
    // 动图 height 是单帧高 × 帧数，取 pageHeight 更准
    height = outMeta.pageHeight ?? outMeta.height ?? 0;
  } catch {
    return fail('图片解析失败，请确认文件未损坏');
  }

  const hash = createHash('sha256').update(out).digest('hex');
  const key = `media/${hash}`;

  // 响应式派生图：预生成 < 原宽的档位（400/800/1600）webp，存为 <hash>_w<width>.webp，供 /api/media 直接出图。
  const variants: { width: number; body: Buffer }[] = [];
  try {
    for (const w of RESPONSIVE_WIDTHS) {
      if (w < width) {
        const v = await sharp(input, { animated: true })
          .rotate()
          .resize({ width: w, withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();
        variants.push({ width: w, body: v });
      }
    }
  } catch {
    // 派生失败不影响主图上传；缺档时 /api/media 自动回退原图
  }

  try {
    await putObject(key, out, 'image/webp');
    for (const v of variants) {
      await putObject(`media/${hash}_w${v.width}.webp`, v.body, 'image/webp');
    }
    const db = getDb();
    await db
      .insert(media)
      .values({
        hash,
        mime: 'image/webp',
        sizeBytes: out.byteLength,
        width,
        height,
        uploaderId: actor.id,
      })
      .onConflictDoNothing({ target: media.hash });
  } catch {
    return fail('上传失败，请稍后重试');
  }

  return { ok: true, data: { url: `/api/media/${hash}`, width, height } };
}
