// 文章系列（ADR-0014）：作者主导的有序编排元数据。不触碰修订模型——
// 系列不含正文、不进内容寻址链；series_items 是可变编排指针。
import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { documents } from './content';

export const series = pgTable(
  'series',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // 短 slug（nanoid，与 documents 同思路），URL /series/<slug>
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('series_owner_idx').on(t.ownerId)],
);

// document_id 作主键 = 一篇文章至多属于一个系列（ADR-0014）。
export const seriesItems = pgTable(
  'series_items',
  {
    documentId: uuid('document_id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    seriesId: uuid('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    // 系列内顺序（不强制唯一，重排时整体改写）
    position: integer('position').notNull().default(0),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('series_items_series_position_idx').on(t.seriesId, t.position)],
);
