// 轻量互动：点赞 / 收藏。一张表两种 kind，按 (user, document, kind) 唯一。
import { sql } from 'drizzle-orm';
import { check, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { documents } from './content';

export const docReactions = pgTable(
  'doc_reactions',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    // 'like' | 'bookmark'
    kind: text('kind').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.documentId, t.kind] }),
    check('doc_reactions_kind_check', sql`${t.kind} in ('like', 'bookmark')`),
  ],
);
