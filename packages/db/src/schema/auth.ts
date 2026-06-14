// better-auth 认证表：表名/列名严格采用官方 drizzle adapter 默认值
// （单数表名 + camelCase 列名，id 为 text）；adapter 按 fieldName 取列，不得改名。
// user 表在官方必需列之外追加业务列 username/bio/status。
import { sql } from 'drizzle-orm';
import {
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

export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    // 统一身份：name 既是署名也是 @提及句柄，全站唯一（lower 唯一索引），允许中文。
    // 格式由应用层把关（2–20 位任意文字字母/数字/_/-，无空白）；改名走 renameUser（限频+留痕）。
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('emailVerified').notNull().default(false),
    image: text('image'),
    createdAt: timestamp('createdAt', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).notNull().defaultNow(),
    // —— 以下为业务追加列（better-auth additionalFields 对接）——
    bio: text('bio'),
    // 教育阶段标签（旧单字段，已被 education 取代）：仅作老资料展示兜底，新写入一律置空
    educationStage: text('education_stage'),
    // 教育经历（自愿，公开展示）：有序多条，每条 = 学历阶段 + 学校 + 选填专业/方向
    education: jsonb('education').$type<{ stage: string; school: string; field?: string }[]>(),
    status: text('status').notNull().default('active'),
    // 账号注销（软删）：置位后 PII 已匿名化、会话清除、不可登录；内容署名保留为「已注销用户」
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // 邮件通知偏好（默认开）：worker 据此决定是否发通知邮件
    emailNotifications: boolean('emailNotifications').notNull().default(true),
    // 注册时的法律同意凭证（PRD §7 前置决策）：由 better-auth additionalFields 服务端强制写入，
    // 存协议版本号，同意时间即 createdAt——平台对 CC BY-SA 授权必须可举证，缺失即拒绝注册。
    licenseConsentVersion: text('licenseConsentVersion').notNull().default(''),
    covenantConsentVersion: text('covenantConsentVersion').notNull().default(''),
    // 两步验证开关（better-auth twoFactor 插件必需列）：仅在 TOTP 首次校验通过后置真
    twoFactorEnabled: boolean('twoFactorEnabled').notNull().default(false),
  },
  (t) => [
    check('user_status_check', sql`${t.status} in ('active', 'suspended')`),
    // 名字唯一性按小写比较（拉丁字母不区分大小写；CJK 不受影响）
    uniqueIndex('user_name_lower_uq').on(sql`lower(${t.name})`),
  ],
);

// 改名历史：旧名 → 用户（隐藏稳定标识符 user.id）。双职：
// ① 旧 @提及 的重定向解析（同名多行取最近一次让渡）；② 改名限频的滚动窗口计数。
export const userNameHistory = pgTable(
  'user_name_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    oldName: text('old_name').notNull(),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('user_name_history_old_name_idx').on(t.oldName),
    index('user_name_history_user_id_idx').on(t.userId, t.changedAt),
  ],
);

// better-auth twoFactor 插件表：TOTP 密钥与备用恢复码（均由插件加密/哈希后存储）；
// verified = 首个 TOTP 校验是否已通过（未通过前 2FA 不生效）
export const twoFactor = pgTable(
  'twoFactor',
  {
    id: text('id').primaryKey(),
    secret: text('secret').notNull(),
    backupCodes: text('backupCodes').notNull(),
    verified: boolean('verified').notNull().default(false),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('two_factor_user_id_idx').on(t.userId)],
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

// @better-auth/passkey 插件表：WebAuthn 凭证（仅存公钥与签名计数器，私钥永远留在用户设备/云钥匙串）
export const passkey = pgTable(
  'passkey',
  {
    id: text('id').primaryKey(),
    // 用户给凭证起的标识名（如「我的 iPhone」），可空
    name: text('name'),
    publicKey: text('publicKey').notNull(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    credentialID: text('credentialID').notNull(),
    // 签名计数器：防凭证克隆重放
    counter: integer('counter').notNull(),
    // singleDevice | multiDevice（多设备 = 可云同步的通行密钥）
    deviceType: text('deviceType').notNull(),
    backedUp: boolean('backedUp').notNull(),
    transports: text('transports'),
    createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow(),
    // 验证器型号标识（Apple 默认置零 AAGUID，可空）
    aaguid: text('aaguid'),
  },
  (t) => [
    index('passkey_user_id_idx').on(t.userId),
    index('passkey_credential_id_idx').on(t.credentialID),
  ],
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
