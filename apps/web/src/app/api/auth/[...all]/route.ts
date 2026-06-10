import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '@/lib/auth';

// 传函数而非实例：路由模块在构建期被加载，惰性转发保证那一刻不初始化 better-auth
export const { GET, POST } = toNextJsHandler((request: Request) => getAuth().handler(request));
