// 验证媒体管线：造图 → sharp 转 webp + 内容寻址 → 存 MinIO + 登记 media 表 → 取回比对。
// 用法（需先起 MinIO 与 PG）：pnpm exec tsx apps/web/scripts/media-check.mts
import { createHash } from 'node:crypto';
import { getDb, media } from '@harublog/db';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { getObject, putObject } from '../src/server/storage';

async function main(): Promise<void> {
  // 造一张带「假 EXIF」的测试图（sharp 输出会抹除元数据）
  const png = await sharp({
    create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 80, b: 80 } },
  })
    .png()
    .toBuffer();

  const out = await sharp(png, { animated: true }).rotate().webp({ quality: 82 }).toBuffer();
  const meta = await sharp(out).metadata();
  const hash = createHash('sha256').update(out).digest('hex');
  const key = `media/${hash}`;

  await putObject(key, out, 'image/webp');
  const db = getDb();
  await db
    .insert(media)
    .values({
      hash,
      mime: 'image/webp',
      sizeBytes: out.byteLength,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
    })
    .onConflictDoNothing({ target: media.hash });

  const fetched = await getObject(key);
  const roundTripOk = Buffer.from(fetched.body).equals(out);
  const row = (await db.select().from(media).where(eq(media.hash, hash)).limit(1))[0];

  console.log(
    `RESULT ${JSON.stringify({
      hash: hash.slice(0, 12),
      webpBytes: out.byteLength,
      dims: `${meta.width}x${meta.height}`,
      storedAndReadBack: roundTripOk,
      contentType: fetched.contentType,
      rowRegistered: row?.mime === 'image/webp',
      url: `/api/media/${hash}`,
    })}`,
  );
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
