# 求学路（Qiuxuelu）

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![Code](https://img.shields.io/badge/code-AGPL--3.0-blue)](LICENSE)
[![Content](https://img.shields.io/badge/content-CC_BY--NC--SA_4.0-green)](https://creativecommons.org/licenses/by-nc-sa/4.0/)

> 围绕求学与成长经验的**多人协作开放博客**——经验可沉淀、可审校、可共建。
> 博客的阅读体验 × Wiki 的协作深度 × 论坛的社区治理。

每一篇文章都是一份**活文档**：作者发布个人经验，社区成员可以批注、提编辑建议、提交修订申请乃至直接修订，全程留痕、可追溯、可回退。贡献越多、越被采纳，解锁的协作能力越高。

🌐 在线示例：**[study.haruyuki.cn](https://study.haruyuki.cn)**

## 核心特性

- **活文档与全量修订**：块级内容寻址 + 不可变修订链，任意版本可对比（diff）、可回退，全历史即贡献凭证。
- **阶梯式协作**：评论 → 行内批注 → 编辑建议 → 修订申请 → 直接修订，随贡献积分逐级解锁。
- **三方合并**：并发改同一篇统一走修订层——主线未动则快进、前移则自动变基、真冲突走三栏逐块裁决（无实时同屏协同，并发在修订层收敛）。
- **双线治理**：自上而下的职务（超管/管理员/板块版主/编辑）与自下而上的**贡献积分等级**并行；一切权限判断走唯一鉴权入口 `can()`（返回裁决 + 义务）。
- **贡献积分晋升**：发文 / 行内批注 / 编辑建议 / 修订被采纳累计积分，达阈值晋升，近一年窗口滚动考核（阈值走站点配置，不硬编码）。
- **发布审批 + 页面模式**：文章经审批公开；私有页累计实质协作到阈值后自动转公共页，协作权限相应放开。
- **AI 评论审核**：DeepSeek 秒审，宁放勿误伤，拦下的进管理员复核队列（未配置则自动放行）。
- **块级中文搜索**：Meilisearch 索引 + worker 事务性同步，⌘K 命令面板与分面筛选，命中直达段落。
- **媒体管线**：图片走 MinIO（S3 兼容），上传即剥 EXIF + 转 WebP + 内容寻址去重，同源代理出图。
- **治理透明**：举报 / 巡查 / 制裁 / 申诉全流程，审计日志，公开的透明度报告与协作公示页。
- **数据可携**：NDJSON 全量导出（自带 CC BY-NC-SA 与贡献者署名），备份恢复演练（RTO<1h / RPO<5min）。
- **更多**：点赞与收藏、板块邮件订阅、文章系列、OG 分享卡、响应式图片、阅读时长与目录滚动高亮、个人中心、超管板块管理后台。

## 技术栈

Next.js 16（RSC，自托管）· React 19 · TypeScript（严格模式）· Tailwind CSS 4 · Tiptap 3 / ProseMirror · Drizzle ORM · PostgreSQL · Meilisearch · MinIO（S3 兼容）· better-auth · pg-boss · Turborepo + pnpm · Biome

阅读端**零编辑器 JS**、渲染器禁用 `dangerouslySetInnerHTML`（UGC XSS 红线）；协作内核为纯函数、零 IO。

## 快速开始

```bash
# 前置：Node ≥ 22、pnpm 10、Docker

# 1. 启动本地依赖（PostgreSQL + MinIO + Meilisearch）
docker compose -f infra/docker-compose.yml up -d

# 2. 安装依赖
pnpm install

# 3. 环境变量：复制模板并生成 BETTER_AUTH_SECRET
cp env.example .env
#   把 BETTER_AUTH_SECRET 换成 `openssl rand -base64 32` 的输出

# 4. 建表 + 种子数据（板块 + 治理阈值）
pnpm db:migrate && pnpm db:seed

# 5. 启动（各开一个终端）
pnpm dev                              # web → http://localhost:3000
pnpm --filter @harublog/worker start  # 搜索同步 + 行内锚点重映射 + 通知邮件

# 可选：已有数据时一次性重建搜索索引（索引非真相源，可随时从 PG 重放）
pnpm --filter @harublog/worker reindex
```

不配 `RESEND_API_KEY` / `DEEPSEEK_API_KEY` 也能跑：邮件走控制台打印、AI 审核自动关闭，流程仍可端到端验证。

常用命令：

```bash
pnpm typecheck    # 全仓类型检查
pnpm test         # 内核合并矩阵、信任结算等单测
pnpm lint         # Biome 检查（lint:fix 自动修复）
pnpm boundaries   # 包依赖方向铁律检查（kernel ← db ← domain ← apps）
pnpm build        # 生产构建
```

## 仓库结构

```
apps/web            Next.js 应用：阅读端 + 写作台 + 管理后台 + 搜索/通知 + 修订申请/协作
apps/worker         事务性 outbox 消费者：搜索同步 + 行内锚点重映射（reindex 可全量重建）+ 通知邮件
packages/kernel     ★ 协作内核：规范化哈希 / 块级 diff / 三方合并 / 锚点重映射 / 修订 diff 模型（纯函数零 IO）
packages/db         Drizzle schema 与迁移 + 块身份映射（PostgreSQL 是唯一真相源）
packages/domain     鉴权引擎 can()（裁决 + 义务）/ 贡献积分引擎 / 工作流状态机
packages/editor     共享 Tiptap 扩展 / schema / 块身份插件 / kernel↔Tiptap 归一化（schema 唯一事实源）
packages/renderer   ProseMirror JSON → RSC/HTML 渲染器 + 修订 diff 视图（阅读端零编辑器 JS）
packages/search     Meilisearch 块级索引映射与同步（中文友好，命中直达段落）
packages/ui         设计系统「纸页与批注」+ 中文排版层 .prose-zh + diff 样式
packages/config     全站共享常量
infra/              docker-compose（PostgreSQL + MinIO + Meilisearch）+ 备份脚本
```

## 文档

| 文档 | 内容 |
|---|---|
| [docs/01-vision-and-requirements.md](docs/01-vision-and-requirements.md) | 愿景与需求（PRD）：项目北极星与术语表 |
| [docs/02-architecture.md](docs/02-architecture.md) | **架构定稿**（最高权威技术文档） |
| [docs/03-permissions.md](docs/03-permissions.md) | 双线权限与能力矩阵 |
| [docs/adr/](docs/adr/) | 架构决策记录（为什么这么做） |
| [docs/runbooks/](docs/runbooks/) | 部署与备份恢复运维手册 |

核心不变量（修订模型语义、唯一鉴权入口 `can()`、依赖方向、内核纯函数、阅读端零编辑器 JS）见架构文档；结构性变更须先附 [ADR](docs/adr/README.md)。

## 路线

五个架构里程碑（M0 内核与骨架 → M5 规模化）已全部交付，详见架构文档 §8。当前处于打磨与硬化阶段（无障碍、性能、安全审计、测试覆盖）。M5 后的产品/模型调整均以 ADR 记录。

> 注：早期曾实现实时协作（Yjs/Hocuspocus），后于 [ADR-0012](docs/adr/0012-retire-realtime-collab-merge-on-commit.md) 退役——同屏协同对学习站过度工程，并发统一收敛到修订层三方合并。

## 参与贡献

欢迎 issue 与 PR。结构性变更（数据模型、权限模型、核心选型）合入前必须附 [ADR](docs/adr/README.md)。提交前请确保 `pnpm lint && pnpm typecheck && pnpm test` 全绿，并遵循 Biome 风格（单引号、分号、2 空格）与中文注释约定。

## 许可证

本项目对**代码**与**内容**采用不同许可：

- **代码**：[GNU AGPL-3.0](LICENSE)。可自由使用、修改、再分发；若以网络服务形式向他人提供修改版，须一并公开对应源码。
- **内容**：平台用户贡献的文章默认 **[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)**——署名（归原作者及全部贡献者）+ 非商业 + 相同方式共享；修订历史即贡献凭证。
