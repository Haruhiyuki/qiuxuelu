import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// apps/web 仅对「纯逻辑」做单测（lib 下无 React/Next 依赖的模块）：node 环境即可。
// 组件/服务端动作含 React/DB/网络副作用，不在此范围（避免引入 jsdom 与重型 mock）。
export default defineConfig({
  test: {
    include: ['src/lib/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
