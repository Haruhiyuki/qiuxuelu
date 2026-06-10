// 惰性单例：模块加载（含 Next.js 构建期）不连库也不读 env，
// 首次实际访问 db 时才创建连接；无 DATABASE_URL 在那一刻才抛错。

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;

interface ClientBundle {
  sql: postgres.Sql;
  db: Database;
}

let cached: ClientBundle | undefined;

function init(): ClientBundle {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('环境变量 DATABASE_URL 未设置，无法创建数据库连接');
    }
    const sql = postgres(url);
    cached = { sql, db: drizzle(sql, { schema }) };
  }
  return cached;
}

export function getDb(): Database {
  return init().db;
}

/** 脚本（seed/迁移）收尾时显式关闭连接，否则 postgres.js 连接池会挂住进程 */
export async function closeDb(): Promise<void> {
  if (cached) {
    await cached.sql.end();
    cached = undefined;
  }
}

// Proxy 转发使 `import { db }` 的人体工学与真实实例一致，但推迟初始化到首次访问
export const db: Database = new Proxy({} as Database, {
  get(_target, prop) {
    const real = init().db as unknown as Record<PropertyKey, unknown>;
    const value = real[prop as keyof typeof real];
    // 方法须绑回真实实例，drizzle 内部依赖 this 指向
    return typeof value === 'function' ? value.bind(real) : value;
  },
});
