// 标签体系：tags（名称唯一）+ document_tags（多对多）。标签按名称检索（/t/<name>）。
import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { documents } from './content';

export const tags = pgTable('tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const documentTags = pgTable(
  'document_tags',
  {
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.tagId] })],
);
