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
M0–M5 全部架构里程碑已完成。后续为打磨与硬化（无障碍、性能、安全审计、测试覆盖等），无新里程碑。
- M1：修订 diff / 回滚 / 评论 / 通知 / Meilisearch 块级搜索 + worker。
- M2：行内评论 + 锚点重映射、信任结算（可重放）、协作直编 + 巡查队列、举报与制裁、管理后台、审计查看。
- M3：编辑建议=真实修订分支、补丁 diff、审校队列、三方合并（快进/自动变基）、三栏冲突裁决、信任联动。
- M4：apps/collab Hocuspocus 网关 + Yjs 草稿态实时协作 + presence + checkpoint 缝合（Y.Doc→collab_checkpoint 修订）。
- M5：数据导出（worker NDJSON + /api/export，自带 CC BY-SA + 贡献者）、/transparency 透明度报告、备份恢复演练（infra/backup + runbook，RTO<1h/RPO<5min）、可插拔语义检索（env embedder，默认关）。
里程碑路线见架构文档 §8；UI 可以糙，内核不能糙。
搜索/锚点同步：apps/worker 轮询 search_outbox（doc.published 触发 Meilisearch 同步 + 行内锚点重映射）；pg-boss 仍留给后续真·异步作业。
信任结算：apps/web/server/trust.ts 的 recomputeTrust 从源表派生（可重放）；suggestionsMerged/mergeRejectRatio 已接入窗口（解锁 TL3）；TL4 仅人工授予（setTrustLevel 锁定）。
建议合并：mergeSuggestion 用 kernel threeWayMerge；建议分支修订带 revisions.suggestion_id（不进主线历史，merge commit 在主线 suggestion_id=null）。
实时协作：rev 的 seq 是文档全局单调计数（与分支无关），新修订一律 max(seq)+1；collab 网关鉴权用 web 签发的 HMAC token（COLLAB_SECRET 两端一致）；编辑器 schema 唯一事实源在 @harublog/editor。
媒体：图片走 MinIO（S3 兼容），uploadMedia 动作先 can('media.upload') 再 sharp 剥 EXIF+转 webp+sha256 内容寻址去重，元数据落 media 表，私有桶经 /api/media/<hash> 同源代理出图（天然过渲染器「仅站内图源」红线）。
编辑器：@harublog/editor 是 web 与 collab 共享的 schema 唯一事实源（kernel 全部块型/标记已打通往返，唯一有损=表格 header 归一为普通单元格）；web 在共享 schema 上叠加 React NodeView（figure/callout/math）、斜杠菜单、气泡菜单等纯 UI 增强（不改 schema）。新增 kernel 块型/标记需同步 normalize 双向 + BlockId TOP_BLOCK_TYPES（顶层块）+ 渲染器；underline/任务清单需先升 SCHEMA_VERSION（ADR-0003）。
