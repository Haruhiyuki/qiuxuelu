// 基础设施表：审计、站点配置、合规删除、通知与搜索 outbox（M1 预留）
import { bigserial, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { blobs } from './content';
import { sections } from './sections';

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorId: text('actor_id').references(() => user.id),
    action: text('action').notNull(),
    subjectType: text('subject_type'),
    subjectId: text('subject_id'),
    sectionId: uuid('section_id').references(() => sections.id),
    detail: jsonb('detail'),
    // 最小化收集：只存哈希不存明文 IP。M0 暂不写入（所有审计行此列为 null）；
    // M1 启用时必须以服务端密钥 HMAC 后写入，禁止明文——勿据此列声称已有 IP 追溯能力。
    ipHash: text('ip_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_created_at_idx').on(t.createdAt),
    index('audit_log_subject_idx').on(t.subjectType, t.subjectId),
  ],
);

export const siteSettings = pgTable('site_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text('updated_by').references(() => user.id),
});

// 合规删除审批记录：blob 内容替换为墓碑的唯一合法通道，仅 superadmin、全审计
export const redactions = pgTable('redactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  blobHash: text('blob_hash')
    .notNull()
    .references(() => blobs.hash),
  requestedBy: text('requested_by').references(() => user.id),
  approvedBy: text('approved_by').references(() => user.id),
  reason: text('reason').notNull(),
  legalBasis: text('legal_basis'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id),
  kind: text('kind').notNull(),
  payload: jsonb('payload'),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const searchOutbox = pgTable('search_outbox', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  topic: text('topic').notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
});
