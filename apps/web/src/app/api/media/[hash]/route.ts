// 媒体同源代理（私有桶不直连）：GET /api/media/<hash> → 流式回传对象，长缓存（内容寻址，永不变）。
// 响应式：?w=400|800|1600 回传上传时预生成的该宽度 webp 派生图；无该派生（如旧图/原图更小）则回退原图。
// 同源出图天然通过渲染器「仅站内图源」红线，无需放宽白名单。缩放放在上传侧（media.ts 的 sharp），路由不引 sharp。
import { getDb, media as mediaTable } from '@harublog/db';
import { eq } from 'drizzle-orm';
import { getObject } from '@/server/storage';

const HASH_RE = /^[0-9a-f]{64}$/;
const ALLOWED_WIDTHS = new Set([400, 800, 1600]);
const LONG_CACHE = 'public, max-age=31536000, immutable';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ hash: string }> },
): Promise<Response> {
  const { hash } = await params;
  if (!HASH_RE.test(hash)) {
    return new Response('未找到', { status: 404 });
  }
  // 仅放行 media 表登记过的对象（防把对象存储当任意网关探测）
  const db = getDb();
  const rows = await db
    .select({ mime: mediaTable.mime })
    .from(mediaTable)
    .where(eq(mediaTable.hash, hash))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return new Response('未找到', { status: 404 });
  }

  const wParam = new URL(req.url).searchParams.get('w');
  const width = wParam === null ? null : Number(wParam);
  const wantVariant = width !== null && ALLOWED_WIDTHS.has(width);

  try {
    // 派生图：取上传时预生成的 <hash>_w<width>.webp；不存在则回退原图
    if (wantVariant) {
      try {
        const variant = await getObject(`media/${hash}_w${width}.webp`);
        return new Response(variant.body as BodyInit, {
          headers: { 'content-type': 'image/webp', 'cache-control': LONG_CACHE },
        });
      } catch {
        // 无该派生：回退原图（仍是合法图片，只是未降采样）
      }
    }
    const obj = await getObject(`media/${hash}`);
    return new Response(obj.body as BodyInit, {
      headers: { 'content-type': row.mime, 'cache-control': LONG_CACHE },
    });
  } catch {
    return new Response('未找到', { status: 404 });
  }
}
