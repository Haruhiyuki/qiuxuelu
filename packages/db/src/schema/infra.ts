// 基础设施表：审计、站点配置、合规删除、通知与搜索 outbox（M1 预留）
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
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { blobs } from './content';
import { sections } from './sections';

// 站点新闻/公告（近闻页 + 首页公告栏）：管理员发布，正文复用博客编辑器（kernel DocJson）。
export const announcements = pgTable(
  'announcements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    // 一句话摘要（选填）：近闻列表/首页摘录用；为空时回退 body 纯文本截断。
    summary: text('summary'),
    // body 现作为「正文纯文本镜像」：从 bodyDoc 提取，供摘录/meta/搜索与旧行兜底（保留 notNull）。
    body: text('body').notNull(),
    // 富正文（kernel DocJson）：复用博客渲染器渲染；旧行为 null 时详情页回退 body 纯文本。
    bodyDoc: jsonb('body_doc'),
    // 正文编辑器 schema 版本（ADR-0003），随 SCHEMA_VERSION 写入，便于将来迁移。
    schemaVersion: integer('schema_version').notNull().default(1),
    // info=普通新闻；notice=重要公告（样式更醒目）
    level: text('level').notNull().default('info'),
    // draft 不公开；published 进近闻页；archived 下线
    status: text('status').notNull().default('published'),
    // 置顶到首页公告栏（可多条，公告栏取最新一条）
    pinned: boolean('pinned').notNull().default(false),
    // 可选行动链接（站内路径或外链）
    linkHref: text('link_href'),
    linkLabel: text('link_label'),
    authorId: text('author_id').references(() => user.id),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('announcements_level_check', sql`${t.level} in ('info', 'notice')`),
    check('announcements_status_check', sql`${t.status} in ('draft', 'published', 'archived')`),
    index('announcements_status_published_idx').on(t.status, t.publishedAt),
  ],
);

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
  // 邮件触达去重：worker 发完通知邮件后置位（含「偏好关/无需发」也置位，避免反复扫描）
  emailedAt: timestamp('emailed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const searchOutbox = pgTable('search_outbox', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  topic: text('topic').notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
});
