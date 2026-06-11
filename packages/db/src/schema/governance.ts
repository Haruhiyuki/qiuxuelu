// 治理层（ADR-0005 双线权限）：角色授予、信任引擎、制裁、发布审批、审校队列
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { documents, revisions } from './content';
import { sections } from './sections';

export const roleGrants = pgTable(
  'role_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    role: text('role').notNull(),
    // editor/section_mod 的板块作用域；admin 级为 null = 全局
    sectionId: uuid('section_id').references(() => sections.id),
    grantedBy: text('granted_by').references(() => user.id),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    // 任期制：到期自动失效
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: text('revoked_by').references(() => user.id),
    revokeReason: text('revoke_reason'),
  },
  (t) => [
    check(
      'role_grants_role_check',
      sql`${t.role} in ('superadmin', 'admin', 'section_mod', 'editor')`,
    ),
    // 鉴权热路径：每次装配 Actor 都按 user_id 取授予
    index('role_grants_user_id_idx').on(t.userId),
  ],
);

export const userTrust = pgTable('user_trust', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id),
  // 由 trust_events 事件流结算的物化值，可重放重算
  level: integer('level').notNull().default(0),
  locked: boolean('locked').notNull().default(false),
  manualLevel: integer('manual_level'),
  promotedAt: timestamp('promoted_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const trustEvents = pgTable(
  'trust_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    kind: text('kind').notNull(),
    delta: integer('delta').notNull().default(0),
    refType: text('ref_type'),
    refId: text('ref_id'),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('trust_events_user_id_created_at_idx').on(t.userId, t.createdAt)],
);

export const sanctions = pgTable(
  'sanctions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    kind: text('kind').notNull(),
    // null = 全局制裁
    sectionId: uuid('section_id').references(() => sections.id),
    reason: text('reason').notNull(),
    issuedBy: text('issued_by').references(() => user.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: text('revoked_by').references(() => user.id),
  },
  (t) => [
    check(
      'sanctions_kind_check',
      sql`${t.kind} in ('suspend', 'silence', 'no_suggest', 'no_edit')`,
    ),
    // 鉴权热路径：每次装配 Actor 都按 user_id 取制裁
    index('sanctions_user_id_idx').on(t.userId),
  ],
);

export const publishRequests = pgTable(
  'publish_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    // 审批对象是精确修订而非文章
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => revisions.id),
    requesterId: text('requester_id').references(() => user.id),
    status: text('status').notNull().default('pending'),
    reviewerId: text('reviewer_id').references(() => user.id),
    reasonCode: text('reason_code'),
    reviewNote: text('review_note'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'publish_requests_status_check',
      sql`${t.status} in ('pending', 'in_review', 'approved', 'rejected', 'withdrawn', 'changes_requested')`,
    ),
    // 每文档同时只允许一个未决请求
    uniqueIndex('publish_requests_one_open_per_doc_uq')
      .on(t.documentId)
      .where(sql`${t.status} in ('pending', 'in_review')`),
    // 审稿人不得审自己的提交——架构 §5 的 DB 侧保险（鉴权侧在 domain guards）
    check(
      'publish_requests_no_self_review_check',
      sql`${t.reviewerId} is null or ${t.reviewerId} is distinct from ${t.requesterId}`,
    ),
  ],
);

export const reviewItems = pgTable(
  'review_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    queue: text('queue').notNull(),
    // 多态主体引用，故用 text 而非 uuid（主体可能是任意表的主键）
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    sectionId: uuid('section_id').references(() => sections.id),
    priority: integer('priority').notNull().default(0),
    status: text('status').notNull().default('pending'),
    claimedBy: text('claimed_by').references(() => user.id),
    // 15 分钟认领租约，过期回池
    claimExpiresAt: timestamp('claim_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('review_items_queue_subject_uq').on(t.queue, t.subjectType, t.subjectId),
    check(
      'review_items_queue_check',
      sql`${t.queue} in ('first_post', 'new_document', 'suggestion', 'flag', 'edit_patrol')`,
    ),
    check(
      'review_items_status_check',
      sql`${t.status} in ('pending', 'claimed', 'done', 'expired')`,
    ),
    // 队列轮询（按板块取未决）与租约回收的支撑索引
    index('review_items_queue_status_idx').on(t.queue, t.status, t.sectionId),
    index('review_items_claim_expires_idx').on(t.claimExpiresAt),
  ],
);

export const reviewActions = pgTable('review_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  reviewItemId: uuid('review_item_id')
    .notNull()
    .references(() => reviewItems.id),
  reviewerId: text('reviewer_id').references(() => user.id),
  action: text('action').notNull(),
  // 拒稿必填结构化理由码——由应用层保证
  reasonCode: text('reason_code'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// 举报：每「举报人 × 被举报内容」一行；权重随举报人信任等级（Discourse flag weight）。
// 多条举报聚合到一个 review_items(queue='flag')；裁决结果回写举报人命中率（喂信任窗口）。
export const flags = pgTable(
  'flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // 多态主体：comment（含行内）/ document
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    reporterId: text('reporter_id')
      .notNull()
      .references(() => user.id),
    reasonCode: text('reason_code').notNull(),
    note: text('note'),
    // 举报权重 = f(举报人 TL)，由应用层写入；low-trust 举报权重低
    weight: integer('weight').notNull().default(1),
    status: text('status').notNull().default('open'),
    sectionId: uuid('section_id').references(() => sections.id),
    resolvedBy: text('resolved_by').references(() => user.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('flags_status_check', sql`${t.status} in ('open', 'upheld', 'dismissed')`),
    // 同一用户对同一内容只能举报一次
    uniqueIndex('flags_subject_reporter_uq').on(t.subjectType, t.subjectId, t.reporterId),
    index('flags_subject_idx').on(t.subjectType, t.subjectId),
    index('flags_reporter_idx').on(t.reporterId),
  ],
);
