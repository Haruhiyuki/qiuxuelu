// better-auth 服务端实例（接线方式核实自官方 Next.js 集成文档，better-auth 1.6）。
// 惰性单例（与 @harublog/db 的 client 同一纪律）：betterAuth() 在被调用的瞬间就会
// 启动异步上下文初始化，缺 BETTER_AUTH_SECRET 时在 production（next build 也算）
// 直接抛错——推迟到首个请求才构建实例，保证无任何 env 也能完成构建（CI 红线）。
import { passkey } from '@better-auth/passkey';
import { SITE_NAME } from '@harublog/config';
import { db } from '@harublog/db';
import * as schema from '@harublog/db/schema';
import { basicEmail, sendEmail } from '@harublog/mailer';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { twoFactor } from 'better-auth/plugins';
import { inArray, sql } from 'drizzle-orm';
import { COVENANT_CONSENT_VERSION, LICENSE_CONSENT_VERSION } from './consent';
import { validateName } from './identity';

function buildAuth() {
  return betterAuth({
    // schema 显式传入：adapter 不必回探 db._.fullSchema，惰性 db Proxy 不被提前触发
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    emailAndPassword: {
      enabled: true,
      // 邮箱验证强制：未验证不能登录（注册仍会创建账号；未验证用户尝试登录时
      // better-auth 会自动重发验证邮件）。验证状态同时用于 TL1 晋升（见信任引擎）。
      requireEmailVerification: true,
      // 忘记密码：发含重置链接的邮件（链接落在 /reset-password?token=...）
      sendResetPassword: async ({ user, url }) => {
        const mail = basicEmail(
          '重置你的求学路密码',
          '我们收到了重置密码的请求。点击下方按钮设置新密码；若非本人操作，请忽略此邮件。',
          { label: '重置密码', url },
        );
        await sendEmail({ to: user.email, subject: '重置你的求学路密码', ...mail });
      },
    },
    // 邮箱验证：注册即发；点击链接验证成功后自动登录
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        const mail = basicEmail(
          '验证你的求学路邮箱',
          '点击下方按钮完成邮箱验证。验证后你将解锁更多协作能力。',
          { label: '验证邮箱', url },
        );
        await sendEmail({ to: user.email, subject: '验证你的求学路邮箱', ...mail });
      },
    },
    // GitHub OAuth：配了凭证才启用（env 门控）。OAuth 用户创建时无同意凭证，
    // 由「后置同意」子流程（/onboarding/consent + 贡献动作守卫）补齐，不破坏 §7 红线。
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? {
          socialProviders: {
            github: {
              clientId: process.env.GITHUB_CLIENT_ID,
              clientSecret: process.env.GITHUB_CLIENT_SECRET,
            },
          },
        }
      : {}),
    user: {
      // 同意凭证：邮箱注册由表单提供（input:true）；OAuth 注册缺省、登录后由同意页补齐。
      // 故 required:false——真正的强制在「后置同意守卫」（贡献前必须已同意），全程留痕。
      additionalFields: {
        licenseConsentVersion: { type: 'string', required: false, input: true },
        covenantConsentVersion: { type: 'string', required: false, input: true },
      },
      // 自助换绑邮箱（成熟实践）：验证「新邮箱」所有权——better-auth 1.6 复用下方
      // emailVerification.sendVerificationEmail，并以新邮箱为收件人发送验证链接；
      // 邮箱在用户点击新邮箱里的链接后才真正更换（未点击前仍是旧邮箱）。
      changeEmail: {
        enabled: true,
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const u = user as Record<string, unknown>;
            const lic = u.licenseConsentVersion;
            const cov = u.covenantConsentVersion;
            // 邮箱注册显式传了同意版本：必须正确（防直连 API 传旧/错版本绕过）。
            // OAuth 注册不带这些字段：放行，由后置同意子流程补齐。
            const provided =
              (typeof lic === 'string' && lic.length > 0) ||
              (typeof cov === 'string' && cov.length > 0);
            if (provided && (lic !== LICENSE_CONSENT_VERSION || cov !== COVENANT_CONSENT_VERSION)) {
              throw new APIError('BAD_REQUEST', {
                message: '注册必须确认内容授权协议（CC BY-SA 4.0）与社区公约',
              });
            }
            // 统一身份：name 即 @提及句柄——校验格式 + 全站唯一（小写比较；
            // OAuth 注册名不合法/撞名时退化为可用变体，不阻断注册）。
            const rawName = typeof u.name === 'string' ? u.name.trim() : '';
            const fromOauth = !provided;
            let name = rawName;
            if (validateName(name) !== null) {
              if (!fromOauth) {
                throw new APIError('BAD_REQUEST', {
                  message: validateName(name) ?? '名字不合法',
                });
              }
              name = `用户${Date.now().toString(36).slice(-6)}`;
            }
            const taken = await db
              .select({ id: schema.user.id })
              .from(schema.user)
              .where(inArray(sql`lower(${schema.user.name})`, [name.toLowerCase()]))
              .limit(1);
            if (taken.length > 0) {
              if (!fromOauth) {
                throw new APIError('BAD_REQUEST', {
                  message: '这个名字已被使用，换一个试试',
                });
              }
              name = `${name.slice(0, 14)}-${Date.now().toString(36).slice(-5)}`;
            }
            return { data: { ...user, name } };
          },
        },
        update: {
          before: async (data) => {
            // 改名必须走 renameUser（限频 + 历史留痕 + 唯一性）；封死 update-user 接口的旁路
            if ('name' in (data as Record<string, unknown>)) {
              throw new APIError('BAD_REQUEST', {
                message: '请在账户设置中通过「改名」功能修改名字',
              });
            }
            return { data };
          },
        },
      },
    },
    // 最小化收集（PRD §6）：不在会话中存储明文 IP/UA；速率限制由反代层按连接处理
    advanced: {
      ipAddress: { disableIpTracking: true },
    },
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    // 两步验证（TOTP + 备用恢复码）：用户在账户设置里自助启停；
    // 启用需密码确认且首个 TOTP 校验通过才生效，登录时由客户端插件引导到 /two-factor。
    // 通行密钥（WebAuthn）：rpID 自动取 baseURL 主机名、origin 回退请求头；
    // 通行密钥登录本身即防钓鱼多因素，不再触发 2FA 流程。
    // nextCookies 必须放插件列表末位：Server Action / RSC 流程中的 Set-Cookie 由它写回
    plugins: [twoFactor({ issuer: SITE_NAME }), passkey({ rpName: SITE_NAME }), nextCookies()],
  });
}

export type Auth = ReturnType<typeof buildAuth>;

let cached: Auth | undefined;

export function getAuth(): Auth {
  cached ??= buildAuth();
  return cached;
}
