# 0002. 采用全栈 TypeScript Monorepo（Next.js 16 + Drizzle + better-auth）

- 状态：已采纳
- 日期：2026-06-10
- 关联：docs/02-architecture.md §1

## 背景

协作内核（修订/合并算法）必须与编辑器（ProseMirror）共享同一份文档 schema 与同构代码；团队 1-3 人，须最小化运维面与技术栈数量；读端 SEO 是生存需求。

## 决策

全栈 TypeScript：pnpm + Turborepo monorepo；Next.js 16（App Router/RSC，Docker 自托管）；React 19 + Tailwind 4 + 自有 shadcn 风格组件；Drizzle ORM + PostgreSQL（唯一真相源）；better-auth；Zod 4；Biome + dependency-cruiser；Vitest。API 形态为 Server Actions 直调 domain 服务，不引入 tRPC。

## 备选方案

- **Go/Rust 后端拆分**：失去「一份文档模型前后端复用」，对修订内核是致命摩擦，落选。
- **SvelteKit / React Router 7**：框架本身合格，但 Tiptap/ProseMirror 生态绑定 React，落选。
- **Prisma**：v7 已翻身，但修订内核重度依赖手写 SQL（递归 CTE、CAS、jsonb），SQL 透明的 Drizzle 更匹配；Prisma 列为可接受备选。
- **Auth.js v5**：至今仍 beta、低维护；Lucia 已弃用（2025-03）；better-auth 是 2026 年社区默认答案。
- **tRPC**：单端 Next 应用无网络边界收益；未来多端需求出现时对外暴露只读 REST 即可。

## 后果

- 正面：单语言单仓库，AI 辅助开发与新人上手摩擦最小；包边界即未来拆分切口。
- 负面：深绑 React/Next 生态——以「renderer/domain/kernel 全部框架无关」对冲，apps/web 保持薄壳。
- 跟进：Drizzle 1.0 GA 后按迁移指南升级（锁版本线）。
