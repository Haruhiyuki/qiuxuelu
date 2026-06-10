import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  // generate 不需要数据库；migrate/push 时才要求 DATABASE_URL
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
