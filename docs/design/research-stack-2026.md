# 2026 年 6 月全栈 TS 技术选型核实报告

> 核实日期：2026-06-10。推荐结论针对「1-3 人长期维护的全栈 TypeScript 项目」场景。注：部分版本号来自第三方聚合站点，关键依赖落地前建议再以 npm/GitHub Releases 复核一次。

## 1. Next.js 及同类框架

| 框架 | 当前版本 | 状态 |
|---|---|---|
| Next.js | **16.2.7（LTS，2026-06-01）** | App Router / RSC / Turbopack 均已生产稳定；Next 16 引入 Cache Components（缓存全面改为显式 opt-in，PPR 成为默认行为），全面采用 RSC 的应用普遍报告首屏 JS 减少 50-70% |
| SvelteKit | **2.x**（Svelte 5.55，Runes 体系成熟） | 生产稳定、心智负担低，已支撑 NYT、Apple App Store 等大站 |
| React Router (Remix) | **v7**（Remix v2 的官方延续路线） | 稳定；注意新的 "Remix v3" 是抛弃 React、基于 Preact fork 的全新实验项目，与 RR7 无关，勿混淆 |
| TanStack Start | **1.0（2026-03）** | 刚到 1.0，类型安全极佳、社区热度高（React 开发者采用率约 15%），但生态积累最浅 |

- **一句话结论**：Next.js 16 的 App Router/RSC 争议期已过、进入稳定收割期，但显式缓存模型有学习成本；RR7 与 SvelteKit 是更简单的稳健备选；TanStack Start 可观望。
- **推荐**：✅ 推荐 Next.js 16（生态与长期维护保障最强）；若团队反感 RSC 复杂度，SvelteKit 2 / React Router 7 同样是合理选择。

## 2. Drizzle ORM vs Prisma

- **Drizzle**：v1.0 处于 **RC 阶段（v1.0.0-rc.1，2026-04-30）**，正式 1.0 尚未发布；周下载约 420 万（一年翻倍）；2026 年 3 月 PlanetScale 整体雇佣了 Drizzle 核心团队，获得企业级背书与全职开发投入。
- **Prisma**：**v7.8.0**。Prisma 7（2025 年末）完成史上最大架构重构——移除 Rust 查询引擎、纯 TypeScript 客户端，包体积缩小 90%、查询快约 3 倍；周下载约 780 万仍领先。
- **一句话结论**：社区风向持续偏向 Drizzle（轻量、SQL-first、类型推断好），但 Prisma 7 去 Rust 化后翻身明显，两者都是安全选择。
- **推荐**：✅ 小团队长期项目推荐 **Drizzle**（贴近 SQL、零代码生成、迁移可控）；已熟悉 Prisma 或重度依赖其 DX 工具链则 Prisma 7 同样推荐。

## 3. better-auth vs Auth.js(NextAuth) vs 自研 session

- **Lucia 已弃用属实**：维护者 2024 年末宣布日落、2025 年 3 月正式弃用，项目转型为「自研 session 的教学文档」——这份指南恰好是自研方案的最佳参考。
- **better-auth**：**v1.6.15**（1.7.0-beta.4 测试中）。发版极快，1.6 已含 OpenTelemetry、passkey、SAML/SCIM/组织/2FA 插件，2026 年已被普遍用于生产，是当前新项目的社区默认答案。
- **Auth.js (NextAuth) v5**：**至今仍挂 beta 标签**（v4 仅维护模式）。生产可用且 OAuth 提供商最全（80+），但发版节奏慢、官方明显把精力让位于 Vercel 的商业方案，社区信心走弱。
- **一句话结论**：better-auth 已完成对 Auth.js 的风向取代；自研 session（按 Lucia 指南）适合需求极简且想零依赖的场景。
- **推荐**：✅ 推荐 **better-auth**；不建议新项目选 Auth.js v5（除非强依赖其海量 OAuth 提供商）；自研仅在「只需邮箱+session」时考虑。

## 4. 块编辑器与 Yjs 协作生态

| 方案 | 版本 | 现状 |
|---|---|---|
| Tiptap | **3.26.0**（v3 已稳定，发版活跃） | ProseMirror 之上最主流的封装，AI/协作功能部分走付费云服务 |
| ProseMirror | 持续维护 | 底座地位稳固，直接使用门槛高 |
| BlockNote | **0.39**（已升级到 Tiptap 3 内核） | Notion 风格开箱即用，仍是 0.x，API 有变动风险 |
| Plate | **53.0.7**（2026-06-03） | 基于 Slate，shadcn 式组件分发，发版极快但大版本号跳跃频繁 |
| Yjs | 周下载约 92 万 | **协作 CRDT 的生产默认**，Tiptap/CodeMirror 唯一成熟绑定；Loro 性能最强但生态最年轻（周下载约 1.2 万），Automerge 2.0 居中 |

- **一句话结论**：Tiptap 3 + Yjs 是当前块编辑器+协作的最稳组合；BlockNote 适合「要 Notion 体验、接受 0.x」，Plate 适合深度定制 React 生态。
- **推荐**：✅ 推荐 **Tiptap 3（+ Yjs 如需协作）**；BlockNote 可选但留意 0.x 破坏性更新；Loro 暂不推荐小团队。

## 5. Tailwind CSS v4 与 shadcn/ui

- **Tailwind CSS**：当前 **v4.3**（4.3.0 于 2026-05 发布；4.2 增加了官方 webpack 插件、新色板、重编译提速 3.8 倍）。v4 的 CSS-first 配置（@theme）已是生态默认，v3→v4 迁移工具成熟。
- **shadcn/ui**：持续高速演进，**CLI v4（2026-03）** 带来 Presets 引擎、registry:base（整套设计系统一键分发）、任意 GitHub 仓库即 registry、shadcn/skills（面向 AI agent 的组件上下文）；全组件已适配 Tailwind v4 + React 19，同时支持 Radix 与 Base UI 底座。
- **一句话结论**：两者均为各自领域的事实标准，且组合即主流。
- **推荐**：✅ 强烈推荐 **Tailwind v4 + shadcn/ui**，几乎是该规模团队的默认正确答案。

## 6. tRPC v11 与 Server Actions 并存实践

- **tRPC**：**v11.16.0**，维护活跃；v11 带来 SSE 订阅、FormData/二进制传输、新 TanStack React Query 集成，要求 TS ≥ 5.7.2。无 v12 迹象，API 稳定。
- **2026 主流共识（混合模式）**：表单提交/简单变更用 **Server Actions**（渐进增强、零样板）；复杂查询、搜索/过滤/分页、需要多端（web+mobile+CLI）复用的 API 用 **tRPC**；两者并存而非二选一，tRPC 官方也支持把 procedure 暴露为 Server Action。
- **一句话结论**：tRPC v11 状态健康，与 Server Actions 的「混合并存」已是社区标准实践。
- **推荐**：✅ 推荐；若项目只有 Next.js 单端且 API 简单，可以只用 Server Actions 省掉 tRPC 一层。

## 7. 中文友好搜索方案

| 方案 | 版本 | 中文能力 |
|---|---|---|
| PGroonga (PostgreSQL) | **4.0.6（2026-04-07）** | 多语言（含中日韩）全文检索，零 ETL，PG18+ 可识别为有序索引（WHERE+ORDER BY+LIMIT 免二次排序），Supabase 官方收录 |
| zhparser (PostgreSQL) | 2.x（基于 SCWS 分词） | 老牌中文分词扩展，可定制词典，但项目演进慢、仅做分词 |
| Meilisearch | **v1.41.0（2026-03-30）** | 中文开箱即用（内置 CJK 分词 + 100+ 语言自动检测），MIT 许可，新增 Dynamic Search Rules |
| Typesense | **v30.2** | 基于 Unicode 切分，**中文等无空格语言支持明显偏弱**，需逐字段配置 locale |

- **一句话结论**：中文场景下 Typesense 是明确短板；「数据不出库」选 PGroonga，「独立搜索服务+即输即搜体验」选 Meilisearch。
- **推荐**：✅ 1-3 人项目首选 **PGroonga**（少维护一个服务），搜索体验要求高再上 **Meilisearch**；zhparser 仅在无法装 PGroonga 时作为兜底；Typesense 不推荐用于中文为主的内容。

## 8. Biome vs ESLint + Prettier

- **Biome**：**v2.3（2026-01）**，423+ 规则；v2 "Biotype" 实现了不依赖 tsc 的自研类型感知 lint，速度比 ESLint 快 10-56 倍；周下载约 880 万，Discord、Slack、Vercel、Node.js 项目本身等已采用。
- **ESLint + Prettier**：周下载约 7930 万仍是绝对存量王者，插件生态（框架专属规则、自定义规则）仍不可替代；Biome 约覆盖常用 ESLint 规则的 80%，深度类型感知规则仍在补齐（路线图至 2026 下半年）。
- **一句话结论**：新项目选 Biome 已是 2026 年的主流建议，单工具、零配置冲突；重度依赖特定 ESLint 插件的存量项目暂不必迁移。
- **推荐**：✅ 推荐 **Biome 2**（小团队维护成本最低）；若依赖 eslint-plugin-* 专项规则（如复杂 a11y、特定框架插件）可保留 ESLint 仅跑 lint、格式化交给 Biome。

---

## 汇总速查

| 领域 | 选型 | 版本 | 推荐 |
|---|---|---|---|
| 框架 | Next.js | 16.2.7 LTS | 推荐 |
| ORM | Drizzle / Prisma | 1.0.0-rc.1 / 7.8.0 | Drizzle 略优，两者皆可 |
| 认证 | better-auth | 1.6.15 | 推荐（Lucia 弃用属实，Auth.js v5 仍 beta） |
| 编辑器 | Tiptap + Yjs | 3.26.0 | 推荐 |
| 样式 | Tailwind + shadcn/ui | 4.3 / CLI v4 | 强烈推荐 |
| API | tRPC + Server Actions 混合 | 11.16.0 | 推荐 |
| 中文搜索 | PGroonga 或 Meilisearch | 4.0.6 / 1.41.0 | 推荐（弃 Typesense） |
| Lint/格式化 | Biome | 2.3 | 推荐 |

Sources:
- [Next.js 16 官方博客](https://nextjs.org/blog/next-16) / [Next.js EOL 版本表](https://eosl.date/eol/product/nextjs/) / [Next.js Cache Components 文档](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents)
- [TanStack Start 官方对比](https://tanstack.com/start/latest/docs/framework/react/comparison) / [TanStack Start v1.0](https://byteiota.com/tanstack-start-v1-0-type-safe-react-framework-2026/) / [Merging Remix and React Router](https://remix.run/blog/merging-remix-and-react-router) / [Remix 3 ditched React](https://blog.logrocket.com/remix-3-ditched-react/) / [What's new in Svelte: May 2026](https://svelte.dev/blog/whats-new-in-svelte-may-2026)
- [Drizzle v1 Roadmap](https://orm.drizzle.team/roadmap) / [Drizzle Releases](https://github.com/drizzle-team/drizzle-orm/releases) / [Prisma 7 发布公告](https://www.prisma.io/blog/announcing-prisma-orm-7-0-0) / [Prisma Releases](https://github.com/prisma/prisma/releases) / [Drizzle vs Prisma 2026](https://makerkit.dev/blog/tutorials/drizzle-vs-prisma)
- [better-auth Releases](https://github.com/better-auth/better-auth/releases) / [Better Auth 1.6](https://better-auth.com/blog/1-6) / [Auth.js v5 beta 状态讨论](https://github.com/nextauthjs/next-auth/discussions/13382) / [LogRocket: Next.js auth 库横评 2026](https://blog.logrocket.com/best-auth-library-nextjs-2026/)
- [Tiptap 3.0 stable](https://tiptap.dev/blog/release-notes/tiptap-3-0-is-stable) / [@tiptap/core npm](https://www.npmjs.com/package/@tiptap/core) / [BlockNote GitHub](https://github.com/TypeCellOS/BlockNote) / [platejs npm](https://www.npmjs.com/package/platejs) / [Yjs vs Automerge vs Loro 2026](https://www.pkgpulse.com/guides/yjs-vs-automerge-vs-loro-crdt-libraries-2026) / [Yjs GitHub](https://github.com/yjs/yjs)
- [Tailwind v4.3 博客](https://tailwindcss.com/blog/tailwindcss-v4-3) / [Tailwind 4.2 InfoQ](https://www.infoq.com/news/2026/04/tailwind-css-4-2-webpack/) / [shadcn CLI v4 changelog](https://ui.shadcn.com/docs/changelog/2026-03-cli-v4) / [shadcn/ui Tailwind v4](https://ui.shadcn.com/docs/tailwind-v4)
- [tRPC v11 公告](https://trpc.io/blog/announcing-trpc-v11) / [@trpc/server npm](https://www.npmjs.com/package/@trpc/server?activeTab=versions) / [tRPC + Server Actions](https://trpc.io/blog/trpc-actions) / [Server Actions vs tRPC 2026 架构指南](https://medium.com/@factman60/next-js-server-actions-vs-trpc-a-2026-architects-guide-85cc4953bae4)
- [PGroonga 官网](https://pgroonga.github.io/) / [PGroonga 4.0.x 公告](https://www.postgresql.org/about/news/pgroonga-404-multilingual-fast-full-text-search-3150/) / [zhparser GitHub](https://github.com/amutu/zhparser) / [Meilisearch vs Typesense 官方对比](https://www.meilisearch.com/comparisons/meilisearch-vs-typesense) / [Meilisearch Releases](https://github.com/meilisearch/meilisearch/releases) / [Typesense Releases](https://github.com/typesense/typesense/releases)
- [Biome vs ESLint 2026](https://www.pkgpulse.com/blog/biome-vs-eslint-prettier-linting-2026) / [Biome 替代 ESLint](https://byteiota.com/biome-replaces-eslint-in-2026-10-20x-faster-linting/) / [Better Stack: Biome vs ESLint](https://betterstack.com/community/guides/scaling-nodejs/biome-eslint/)