// 内容内核（ADR-0003 类 git 模型）：
// blobs(内容寻址) / blocks(稳定块身份) / revisions(commit) /
// revision_blocks(规范化树表，真相) / published_snapshots(物化缓存)
import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { sections } from './sections';

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    summary: text('summary'),
    ownerId: text('owner_id').references(() => user.id),
    status: text('status').notNull().default('draft'),
    editPolicy: text('edit_policy').notNull().default('suggest_only'),
    // 精选/置顶（板块管理员+ 设置）：首页与板块页优先展示
    featured: boolean('featured').notNull().default(false),
    // ProseMirror schema 版本：旧文档渲染/对比时按迁移函数链升级
    schemaVersion: integer('schema_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'documents_status_check',
      sql`${t.status} in ('draft', 'pending', 'published', 'archived')`,
    ),
    check(
      'documents_edit_policy_check',
      sql`${t.editPolicy} in ('suggest_only', 'open', 'semi', 'locked')`,
    ),
  ],
);

export const blobs = pgTable('blobs', {
  // sha256(canon(content)) 的 hex；同内容天然去重
  hash: text('hash').primaryKey(),
  // 规范化算法版本：哈希语义随其变化，不同版本的哈希不可比
  canonVersion: integer('canon_version').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  content: jsonb('content').notNull(),
  textPlain: text('text_plain').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  // 合规墓碑通道（ADR-0003）：内容依法移除但哈希保留以维持链完整性
  redactedAt: timestamp('redacted_at', { withTimezone: true }),
  redactedBy: text('redacted_by').references(() => user.id),
  redactionReason: text('redaction_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const revisions = pgTable(
  'revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    // 文档内单调递增，unique(document_id, seq) 同时充当历史浏览索引
    seq: integer('seq').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => revisions.id),
    mergeParentId: uuid('merge_parent_id').references((): AnyPgColumn => revisions.id),
    // 双署名：合并建议时 author=建议人、committer=审校者，署名喂信任体系
    authorId: text('author_id').references(() => user.id),
    committerId: text('committer_id').references(() => user.id),
    kind: text('kind').notNull(),
    message: text('message'),
    manifestHash: text('manifest_hash').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    charsDelta: integer('chars_delta').notNull().default(0),
    blocksChanged: integer('blocks_changed').notNull().default(0),
    // 建议分支标记（ADR-0004）：非空表示该修订属于某条建议的分支，不在主线历史中展示；
    // null = 主线修订（draft/published 线，含 merge_suggestion 合并提交）。
    suggestionId: uuid('suggestion_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('revisions_document_id_seq_uq').on(t.documentId, t.seq),
    check(
      'revisions_kind_check',
      sql`${t.kind} in ('edit', 'merge_suggestion', 'rollback', 'collab_checkpoint', 'import')`,
    ),
    index('revisions_suggestion_id_idx').on(t.suggestionId),
  ],
);

// M1 实现改名时：slug_history 写入必须用 ON CONFLICT (old_slug) DO UPDATE（slug 可能被释放后再次让渡），
// 且 /a/[slug] 404 前先查此表做 permanentRedirect——见架构 §7 与评审遗留项。
export const blocks = pgTable(
  'blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    type: text('type').notNull(),
    // 分裂血缘：段落分裂时新块指回源块，保证「这一段的历史」不断链
    derivedFromBlockId: uuid('derived_from_block_id').references((): AnyPgColumn => blocks.id),
    // 出生修订：同事务先插 revision 再插 block
    bornRevisionId: uuid('born_revision_id')
      .notNull()
      .references(() => revisions.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('blocks_document_id_idx').on(t.documentId)],
);

export const revisionBlocks = pgTable(
  'revision_blocks',
  {
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => revisions.id),
    position: integer('position').notNull(),
    blockId: uuid('block_id')
      .notNull()
      .references(() => blocks.id),
    blobHash: text('blob_hash')
      .notNull()
      .references(() => blobs.hash),
  },
  (t) => [
    primaryKey({ columns: [t.revisionId, t.position] }),
    uniqueIndex('revision_blocks_revision_id_block_id_uq').on(t.revisionId, t.blockId),
    index('revision_blocks_block_id_idx').on(t.blockId),
  ],
);

export const revisionChanges = pgTable(
  'revision_changes',
  {
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => revisions.id),
    blockId: uuid('block_id')
      .notNull()
      .references(() => blocks.id),
    change: text('change').notNull(),
    oldBlobHash: text('old_blob_hash').references(() => blobs.hash),
    newBlobHash: text('new_blob_hash').references(() => blobs.hash),
    oldPos: integer('old_pos'),
    newPos: integer('new_pos'),
    // 合并血缘：段落合并时记录被并入方向
    mergedIntoBlockId: uuid('merged_into_block_id').references(() => blocks.id),
  },
  (t) => [
    primaryKey({ columns: [t.revisionId, t.blockId] }),
    index('revision_changes_block_id_idx').on(t.blockId),
    check('revision_changes_change_check', sql`${t.change} in ('add', 'modify', 'remove', 'move')`),
  ],
);

export const documentRefs = pgTable(
  'document_refs',
  {
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    // 'draft' | 'published' | 'suggestion/<id>'：全系统唯一可变状态，CAS 移动
    name: text('name').notNull(),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => revisions.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.name] })],
);

export const workingCopies = pgTable(
  'working_copies',
  {
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    baseRevisionId: uuid('base_revision_id').references(() => revisions.id),
    content: jsonb('content').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.userId] })],
);

export const publishedSnapshots = pgTable('published_snapshots', {
  documentId: uuid('document_id')
    .primaryKey()
    .references(() => documents.id),
  revisionId: uuid('revision_id')
    .notNull()
    .references(() => revisions.id),
  // 树表是真相，快照只是发布事务内同步重建的 O(1) 读缓存
  content: jsonb('content').notNull(),
  approvedBy: text('approved_by').references(() => user.id),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
});

export const slugHistory = pgTable('slug_history', {
  oldSlug: text('old_slug').primaryKey(),
  documentId: uuid('document_id')
    .notNull()
    .references(() => documents.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
