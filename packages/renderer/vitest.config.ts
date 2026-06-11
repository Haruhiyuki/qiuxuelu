import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 渲染器测试用 .tsx，启用 React 17+ 自动 JSX 运行时
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['src/**/*.test.tsx'],
  },
});
