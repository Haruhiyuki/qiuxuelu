// 板块（求学阶段维度）：parent_id 支持子板块树
import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { check, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const sections = pgTable(
  'sections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    parentId: uuid('parent_id').references((): AnyPgColumn => sections.id),
    stage: text('stage').notNull(),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('sections_stage_check', sql`${t.stage} in ('junior', 'senior', 'college', 'general')`),
  ],
);
