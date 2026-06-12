// 轻量互动：赞 / 踩 / 收藏。一张表多种 kind，按 (user, document, kind) 唯一；
// like 与 dislike 的互斥（一人一票）由投票动作在事务内保证，不靠约束。
import { sql } from 'drizzle-orm';
import {
  check,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { documents } from './content';
import { sections } from './sections';

export const docReactions = pgTable(
  'doc_reactions',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    // 'like' | 'dislike' | 'bookmark'
    kind: text('kind').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.documentId, t.kind] }),
    check('doc_reactions_kind_check', sql`${t.kind} in ('like', 'dislike', 'bookmark')`),
  ],
);

// 板块订阅：板块有新文发布时邮件通知订阅者。token 用于邮件内一键退订（无需登录）。
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('subscriptions_user_section_uniq').on(t.userId, t.sectionId)],
);
