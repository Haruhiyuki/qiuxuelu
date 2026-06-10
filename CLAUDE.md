# harublog 项目工程约定（AI 辅助开发上下文）

## 必读顺序
1. `docs/02-architecture.md` —— 架构定稿，最高权威；与任何其他材料冲突时以它为准。
2. 涉及结构性改动时读对应 `docs/adr/`；推翻既有决策必须新增 ADR，不准默默改。
3. `docs/01-vision-and-requirements.md` —— 产品需求与术语表（板块=section、文章=document、区块=block、修订=revision、建议=suggestion）。

## 不可妥协的红线
- **修订模型语义不可变**：blobs 内容寻址（hash 不含 blockId）、revisions 不可变、document_refs 是唯一可变指针、建议=真实修订分支。改动这些必须先写 ADR。
- **鉴权唯一入口**：一切权限判断走 `@harublog/domain` 的 `can()`（返回裁决+义务，不是布尔）；新 Server Action 必须先 can() 再干活。
- **依赖方向铁律**：`kernel ← db ← domain ← apps`；renderer/editor 只依赖 kernel；ui 是叶子。`pnpm boundaries` 必须全绿。
- **kernel 纯函数零 IO**，禁止引入框架/数据库依赖；用 @noble/hashes 不用 node:crypto（要进浏览器）。
- **阅读端零编辑器 JS**；渲染器禁止 dangerouslySetInnerHTML（UGC XSS 红线）。
- 高危操作（审批、角色变更、回退、redaction）必须写 audit_log。

## 工程习惯
- TS 严格模式 + verbatimModuleSyntax（纯类型导入写 `import type`）。
- 风格由 Biome 管（单引号、分号、2 空格）；提交前 `pnpm lint && pnpm typecheck && pnpm test`。
- 注释一律中文，只写代码表达不了的约束与原因。
- 依赖版本统一走 `pnpm-workspace.yaml` 的 catalog，不在各包内写裸版本号。
- 数据库改动：改 `packages/db/src/schema/` → `pnpm db:generate` 生成迁移 → 迁移文件入库；禁止手改已合入的迁移。
- 治理阈值（信任等级等）一律走 site_settings 配置，不硬编码。

## 当前阶段
M0、M1 已完成（M1：修订 diff / 回滚 / 评论 / 通知 / Meilisearch 块级搜索 + worker）。当前进入 M2（社区底座）。
里程碑路线见架构文档 §8；UI 可以糙，内核不能糙。
搜索同步：apps/worker 直接轮询 search_outbox（事务性 outbox 即队列）；pg-boss 留给 M2 真·异步作业（与 ADR-0006 一致）。
