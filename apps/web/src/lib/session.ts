import { headers } from 'next/headers';
import { cache } from 'react';
import { getAuth } from './auth';

/**
 * 服务端读取当前会话（RSC / Server Action 通用）。
 * 顺序是刻意的：先 await headers()——构建期的预渲染尝试会在这里触发动态 bailout，
 * 永远走不到 getAuth()，因此缺 env 也不会在构建期初始化 better-auth。
 * React cache() 做请求级去重：根布局 SiteHeader 与各页面/组件常各调一次，
 * 同一请求内只查一次会话，消除重复的 session DB 往返。
 */
export const getSession = cache(async () => {
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
});

export type SessionData = NonNullable<Awaited<ReturnType<typeof getSession>>>;
