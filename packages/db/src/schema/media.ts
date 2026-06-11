// 媒体资产表：内容寻址（hash = 处理后字节的 sha256），对象本体存对象存储（MinIO/S3），
// 此表只存元数据与去重索引。同一 hash 只存一份（上传去重）。
import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth';

export const media = pgTable('media', {
  // 内容地址：既是主键也是对象存储 key 与 /api/media/<hash> 路由参数
  hash: text('hash').primaryKey(),
  mime: text('mime').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  width: integer('width'),
  height: integer('height'),
  uploaderId: text('uploader_id').references(() => user.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
