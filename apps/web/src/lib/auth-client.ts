import { inferAdditionalFields } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import type { Auth } from './auth';

// baseURL 缺省时自动取当前页面 origin：本地与生产同域部署均可不配 NEXT_PUBLIC_APP_URL。
// inferAdditionalFields：让 signUp.email 的类型包含服务端必填的同意凭证字段。
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  plugins: [inferAdditionalFields<Auth>()],
});
