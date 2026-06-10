# 求学路（代号 harublog）

围绕**初中、高中、大学求学生涯**的多人协作开放博客——经验可沉淀、可审校、可共建的公益项目。

> 博客的阅读体验 × Wiki 的协作深度 × 论坛的社区治理。

- 文章是**活文档**：块级修订、全历史可追溯、任意版本可对比可回退；
- 贡献是**阶梯**：评论 → 行内评论 → 编辑建议 → 协作编辑，随信任等级逐级解锁；
- 治理是**双线**：自上而下的职务角色（超管/管理员/板块管理员/编辑）与自下而上的信任等级并行；
- 发布有**审批**：所有文章经审批后公开，已发布文章的修改按保护级走巡查或建议。

## 文档地图

| 文档 | 内容 |
|---|---|
| [docs/01-vision-and-requirements.md](docs/01-vision-and-requirements.md) | 愿景与需求（PRD），项目北极星 |
| [docs/02-architecture.md](docs/02-architecture.md) | **架构定稿 v1.0**（最高权威技术文档） |
| [docs/adr/](docs/adr/) | 架构决策记录（为什么这么做） |
| [docs/design/](docs/design/) | 三份竞争提案 + 调研报告 + 评审意见（设计过程归档） |

## 技术栈

Next.js 16（RSC，自托管）· React 19 · TypeScript（严格模式）· Tailwind CSS 4 · Tiptap 3/ProseMirror · Drizzle ORM · PostgreSQL 18 · better-auth · pg-boss · Turborepo + pnpm · Biome

## 本地开发

```bash
# 0. 前置：Node ≥ 22、pnpm 10、Docker
# 1. 启动数据库
docker compose -f infra/docker-compose.yml up -d
# 2. 安装依赖
pnpm install
# 3. 环境变量
cp env.example .env   # 并把 BETTER_AUTH_SECRET 换成 `openssl rand -base64 32` 的输出
# 4. 建表与种子数据
pnpm db:migrate && pnpm db:seed
# 5. 启动 web 与 worker（worker 把发布事件同步进 Meilisearch）
pnpm dev                              # web: http://localhost:3000
pnpm --filter @harublog/worker start  # 另开一个终端：搜索同步 worker
# 已有数据时一次性重建搜索索引（索引非真相源，可随时从 PG 重放）：
pnpm --filter @harublog/worker reindex
```

常用命令：

```bash
pnpm typecheck    # 全仓库类型检查
pnpm test         # 内核合并矩阵等单测
pnpm lint         # Biome 检查（lint:fix 自动修复）
pnpm boundaries   # 包依赖方向铁律检查（kernel ← db ← domain ← apps）
pnpm build        # 生产构建
```

## 仓库结构

```
apps/web            Next.js 应用（读端 + 写端 + 管理后台 + 搜索/通知）
apps/worker         事务性 outbox 消费者：把发布事件同步进 Meilisearch（reindex 可全量重建）
packages/kernel     ★ 协作内核：规范化哈希 / 块级 diff / 三方合并 / 锚点重映射 / 修订 diff 模型（纯函数）
packages/db         Drizzle schema 与迁移（PostgreSQL 是唯一真相源）
packages/domain     鉴权引擎 can()（裁决+义务）/ 信任引擎 / 工作流状态机
packages/renderer   ProseMirror JSON → RSC/HTML 渲染器 + 修订 diff 视图（阅读端零编辑器 JS）
packages/search     Meilisearch 块级索引映射与同步（中文友好，命中直达段落）
packages/ui         设计系统「纸页与批注」+ 中文排版层 .prose-zh + diff 样式
packages/config     全站共享常量
infra/              docker-compose（PostgreSQL + Meilisearch）/ 部署配置
```

## 里程碑进度

- **M0 内核与骨架** ✅：协作内核、全量数据模型、双线权限 `can()`、阅读端渲染、认证、Docker。
- **M1 可发布的博客** ✅：块编辑器与提交、发布审批工作台、**修订 diff 可视化、回滚、文末评论（一层回复+治理隐藏）、站内通知、Meilisearch 块级中文搜索 + worker**。
- M2 起：行内评论+锚点重映射、信任等级结算、巡查/举报/制裁、编辑建议全流程（见 `docs/02-architecture.md` §8）。

## 许可

- **代码**：建议 AGPL-3.0，待项目所有者在首次公开发布前最终确认（见 PRD §9）。
- **内容**：平台用户贡献内容默认采用 **CC BY-SA 4.0**（同维基百科），署名归原作者及贡献者列表，修订历史即贡献凭证。

## 参与

项目处于 M0（内核与骨架）阶段。结构性变更（数据模型、权限模型、核心选型）合入前必须附 [ADR](docs/adr/README.md)。
