// better-auth 认证表：表名/列名严格采用官方 drizzle adapter 默认值
// （单数表名 + camelCase 列名，id 为 text）；adapter 按 fieldName 取列，不得改名。
// user 表在官方必需列之外追加业务列 username/bio/status。
import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('emailVerified').notNull().default(false),
    image: text('image'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
    // —— 以下为业务追加列（better-auth additionalFields 对接）——
    username: text('username').unique(),
    bio: text('bio'),
    status: text('status').notNull().default('active'),
    // 注册时的法律同意凭证（PRD §7 前置决策）：由 better-auth additionalFields 服务端强制写入，
    // 存协议版本号，同意时间即 createdAt——平台对 CC BY-SA 授权必须可举证，缺失即拒绝注册。
    licenseConsentVersion: text('licenseConsentVersion').notNull().default(''),
    covenantConsentVersion: text('covenantConsentVersion').notNull().default(''),
  },
  (t) => [check('user_status_check', sql`${t.status} in ('active', 'suspended')`)],
);

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_user_id_idx').on(t.userId)],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    idToken: text('idToken'),
    accessTokenExpiresAt: timestamp('accessTokenExpiresAt', {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt', {
      withTimezone: true,
    }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('account_user_id_idx').on(t.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);
