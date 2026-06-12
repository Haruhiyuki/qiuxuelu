import { passkeyClient } from '@better-auth/passkey/client';
import { inferAdditionalFields, twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import type { Auth } from './auth';

// baseURL 缺省时自动取当前页面 origin：本地与生产同域部署均可不配 NEXT_PUBLIC_APP_URL。
// inferAdditionalFields：让 signUp.email 的类型包含服务端必填的同意凭证字段。
// twoFactorClient：开启两步验证的账号在密码校验通过后被引导到 /two-factor 输入动态码。
// passkeyClient：通行密钥注册/登录（含登录页输入框的条件式自动填充）。
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  plugins: [
    inferAdditionalFields<Auth>(),
    twoFactorClient({
      onTwoFactorRedirect() {
        window.location.href = '/two-factor';
      },
    }),
    passkeyClient(),
  ],
});
