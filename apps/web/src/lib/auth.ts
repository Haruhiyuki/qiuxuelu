// better-auth 服务端实例（接线方式核实自官方 Next.js 集成文档，better-auth 1.6）。
// 惰性单例（与 @harublog/db 的 client 同一纪律）：betterAuth() 在被调用的瞬间就会
// 启动异步上下文初始化，缺 BETTER_AUTH_SECRET 时在 production（next build 也算）
// 直接抛错——推迟到首个请求才构建实例，保证无任何 env 也能完成构建（CI 红线）。
import { db } from '@harublog/db';
import * as schema from '@harublog/db/schema';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { COVENANT_CONSENT_VERSION, LICENSE_CONSENT_VERSION } from './consent';

function buildAuth() {
  return betterAuth({
    // schema 显式传入：adapter 不必回探 db._.fullSchema，惰性 db Proxy 不被提前触发
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    emailAndPassword: { enabled: true },
    user: {
      // 注册同意凭证（PRD §7「不可后补的前置决策」）：服务端必填并落库留痕，
      // 客户端勾选只是体验层——直连 API 的注册同样过不了这道闸。
      additionalFields: {
        licenseConsentVersion: { type: 'string', required: true, input: true },
        covenantConsentVersion: { type: 'string', required: true, input: true },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const u = user as Record<string, unknown>;
            if (
              u.licenseConsentVersion !== LICENSE_CONSENT_VERSION ||
              u.covenantConsentVersion !== COVENANT_CONSENT_VERSION
            ) {
              throw new APIError('BAD_REQUEST', {
                message: '注册必须确认内容授权协议（CC BY-SA 4.0）与社区公约',
              });
            }
            return { data: user };
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
    // nextCookies 必须放插件列表末位：Server Action / RSC 流程中的 Set-Cookie 由它写回
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof buildAuth>;

let cached: Auth | undefined;

export function getAuth(): Auth {
  cached ??= buildAuth();
  return cached;
}
