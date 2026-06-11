// 媒体同源代理（私有桶不直连）：GET /api/media/<hash> → 流式回传对象，长缓存（内容寻址，永不变）。
// 同源出图天然通过渲染器「仅站内图源」红线，无需放宽白名单。
import { getDb, media as mediaTable } from '@harublog/db';
import { eq } from 'drizzle-orm';
import { getObject } from '@/server/storage';

const HASH_RE = /^[0-9a-f]{64}$/;

export async function GET(
  _req: Request,
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

  try {
    const obj = await getObject(`media/${hash}`);
    return new Response(obj.body as BodyInit, {
      headers: {
        'content-type': row.mime,
        // 内容寻址：同 hash 内容永不变，可永久缓存
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new Response('未找到', { status: 404 });
  }
}
