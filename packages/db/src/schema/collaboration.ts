// 协作层：建议分支（ADR-0004）、评论、行内锚点
import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { blocks, documents, revisions } from './content';

export const suggestions = pgTable(
  'suggestions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    authorId: text('author_id').references(() => user.id),
    // 真实修订分支：head 沿 parent 链回到 base，补丁是派生物
    baseRevisionId: uuid('base_revision_id')
      .notNull()
      .references(() => revisions.id),
    headRevisionId: uuid('head_revision_id')
      .notNull()
      .references(() => revisions.id),
    status: text('status').notNull().default('open'),
    note: text('note'),
    mergedRevisionId: uuid('merged_revision_id').references(() => revisions.id),
    resolvedBy: text('resolved_by').references(() => user.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'suggestions_status_check',
      sql`${t.status} in ('open', 'under_review', 'changes_requested', 'merged', 'rejected', 'outdated', 'withdrawn')`,
    ),
    // 建议不得由作者本人裁决（撤回除外）——架构 §5 的 DB 侧保险
    check(
      'suggestions_no_self_review_check',
      sql`${t.resolvedBy} is null or ${t.status} = 'withdrawn' or ${t.resolvedBy} is distinct from ${t.authorId}`,
    ),
    index('suggestions_document_id_idx').on(t.documentId),
  ],
);

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    authorId: text('author_id').references(() => user.id),
    parentId: uuid('parent_id').references((): AnyPgColumn => comments.id),
    kind: text('kind').notNull(),
    suggestionId: uuid('suggestion_id').references(() => suggestions.id),
    body: jsonb('body').notNull(),
    status: text('status').notNull().default('visible'),
    hiddenBy: text('hidden_by').references(() => user.id),
    hiddenReason: text('hidden_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
  },
  (t) => [
    check('comments_kind_check', sql`${t.kind} in ('doc', 'inline', 'review')`),
    check('comments_status_check', sql`${t.status} in ('visible', 'hidden', 'deleted')`),
    index('comments_document_id_idx').on(t.documentId),
  ],
);

export const commentAnchors = pgTable(
  'comment_anchors',
  {
    commentId: uuid('comment_id')
      .primaryKey()
      .references(() => comments.id),
    // 锚定靠块身份而非位置：块移动时锚点零成本跟随
    blockId: uuid('block_id')
      .notNull()
      .references(() => blocks.id),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => revisions.id),
    startOffset: integer('start_offset'),
    endOffset: integer('end_offset'),
    // 引文兜底：重映射失败转 orphaned 后仍可展示原文，永不静默丢弃
    quotedText: text('quoted_text').notNull(),
    prefix: text('prefix'),
    suffix: text('suffix'),
    state: text('state').notNull().default('live'),
  },
  (t) => [
    check('comment_anchors_state_check', sql`${t.state} in ('live', 'remapped', 'orphaned')`),
  ],
);
