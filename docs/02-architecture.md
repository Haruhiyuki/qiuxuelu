# 系统架构（定稿 v1.0）

> 状态：已采纳（2026-06-10）。
> 形成过程：三份独立架构提案（协作内核优先 / 产品体验优先 / 治理权限优先）+ 两份调研报告 + 三位评委交叉评审，全部原始材料见 `docs/design/`。三位评委一致裁定以提案 A 为骨架，嫁接 C 的治理层与 B 的阅读端方案，并补齐三案共同盲区。
> 本文是唯一权威架构文档；与提案原文冲突处以本文为准。

## 0. 系统本质

本系统的本质是一个**带审校工作流的中文 wiki 引擎 / 版本化内容数据库**。块级修订模型、建议补丁模型、冲突处理的正确性是第一公民；Web 框架、UI、增长功能都是围绕「协作内核」的外壳。

不可返工的地基（M0 一次成型，此后只增不改语义）：**修订模型、块身份、鉴权层、审计表**。

## 1. 技术栈（具体选型理由见 ADR-0002）

| 层 | 选型 |
|---|---|
| 运行时 | Node.js ≥22（推荐 24 LTS）+ TypeScript 5.9（strict） |
| Web | Next.js 16（App Router + RSC，`next start` + Docker 自托管，不绑定 Vercel） |
| 前端 | React 19 + Tailwind CSS 4 + shadcn/ui 风格自有组件（`packages/ui`） |
| 编辑器 | Tiptap 3（ProseMirror 内核），仅用 MIT 开源核心；建议模式/评论插件自研 |
| ORM / DB | Drizzle ORM + PostgreSQL 18（**PG 是唯一真相源**） |
| 认证 | better-auth（自托管，邮箱+密码起步，OAuth 为 M1） |
| 校验 | Zod 4（domain 与表单共享 schema） |
| 任务队列 | **pg-boss**（队列落在 PG，M0–M2 不引入 Redis 系组件；实时协作期再加 Valkey 仅做 presence） |
| 搜索（M1） | Meilisearch 块粒度索引（PG outbox 单向同步，索引可全量重建）；若运维超载降级 PGroonga |
| 实时协作（M3+） | Yjs + y-prosemirror + Hocuspocus（仅草稿态热层，法定历史只有 revisions） |
| API 形态 | Server Actions + 直接调用 domain 服务（无 tRPC/GraphQL）；对外只读 REST（M4） |
| 工程 | pnpm + Turborepo + Vitest + Biome；依赖方向用 dependency-cruiser 强制 |
| 部署 | Docker Compose + Caddy；单台 4C8G VPS 可起全栈 |

**显式不选**：微服务、多数据库、tRPC（单端应用无收益）、自研编辑器、任意嵌套块（schema 收紧换 diff/合并的可靠性）。

## 2. Monorepo 结构与依赖铁律

```
harublog/
├─ apps/
│  ├─ web/          # Next.js：读端(RSC/ISR) + 写端 + 管理后台 + 公开 API
│  └─ worker/       # (M1) pg-boss 消费者：搜索同步、通知、信任结算、锚点重映射
├─ packages/
│  ├─ kernel/       # ★ 协作内核：schema/ canon/ revision/ merge/ anchor/
│  │                #   纯函数、零 IO、零框架依赖；合并矩阵 100% 单测
│  ├─ db/           # Drizzle schema + 迁移 + 仓储（kernel 的持久化适配器）
│  ├─ domain/       # 应用服务：can() 鉴权、状态机、信任引擎、审计
│  ├─ renderer/     # ProseMirror JSON → HTML/RSC（读端/RSS/OG 共用）
│  ├─ editor/       # (M1) Tiptap 扩展集：blockId 注入、建议模式、评论装饰
│  ├─ search/       # (M1) Meilisearch 映射与同步
│  ├─ ui/           # 设计系统 + 中文排版层 .prose-zh
│  └─ config/       # 共享 tsconfig / 常量
└─ infra/           # docker-compose、caddy、备份脚本
```

**依赖方向铁律**：`kernel ← db ← domain ← apps`；`kernel` 不得 import 任何上层；`renderer`/`editor` 只依赖 `kernel`。由 dependency-cruiser 在 CI 强制，违反即红灯。未来拆服务（协作网关、搜索）的切口就在包边界上。

## 3. 核心数据模型

### 3.1 类 git 模型 + 三处关键改造

| git | 本系统 | 改造 |
|---|---|---|
| blob | `blobs`：单块内容寻址快照，`hash = sha256(canon(content))` | 内容是规范化 ProseMirror 节点 JSON |
| tree | `revision_blocks`：**规范化窄表**（修订→有序块清单） | 弃 jsonb 整存，换外键完整性与索引查询（嫁接自提案 C） |
| commit | `revisions`：parent + merge_parent，文档内单调 `seq` | `author_id`（内容作者）与 `committer_id`（落盘者）双署名（嫁接自 B）：合并建议时 author=建议人——署名直接喂信任体系 |
| ref | `document_refs`：`draft` / `published` / `suggestion/<id>` | 「发布」= 移动 published ref；审批对象是**具体修订**而非文章 |
| —— | `blocks`：稳定块身份（UUID，跨修订不变） | git 靠启发式猜 rename，我们发不可变身份。行内评论锚定、块级历史、合并判定全部受益 |

附加设计（评委指出的共同盲区，全部在 M0 落库）：

- **块血缘**：`blocks.derived_from_block_id`（段落分裂时新块指回源块）；`revision_changes.merged_into_block_id`（段落合并时被并入方向）。保证「这一段的历史」在重构后不断链。
- **规范化版本**：`blobs.canon_version`（规范化算法版本，哈希语义随其变化）；`revisions.schema_version`（ProseMirror schema 版本）。kernel 维护 schema 迁移函数链，旧修订渲染/对比时按链升级到当前版本。
- **合规删除通道（redaction）**：不可变历史与法定删除义务（未成年人信息、被遗忘权）冲突的唯一出口——`redactions` 表 + blob 内容替换为墓碑 `{redacted: true}`（哈希保留以维持链完整性），修订历史显示「内容已依法移除」，操作仅 superadmin、全审计。参照 MediaWiki revision suppression。
- **物化读路径**：`published_snapshots(document_id PK, revision_id, content jsonb)`，发布事务内同步重建，文章页 O(1) 单行读（嫁接自 B）；树表是真相，快照是缓存。
- **slug 历史**：`slug_history` 表支撑改名 301。

### 3.2 编辑与提交

- 自动保存写可变的 `working_copies`（每人每文档一行），**只有显式提交才产生修订**，杜绝修订垃圾。
- 提交时 kernel 按 blockId 对齐 diff：仅变化的块产生新 blob；未变块在新修订的树中复用旧 blob（结构共享）。同时物化 `revision_changes`（add/modify/remove/move），块级 blame O(1)。
- 并发三道防线：① presence 软提示（M1）；② 提交携带 base_revision，ref 已前移则事务内三方自动变基；③ CAS 移动 ref（`WHERE revision_id = expected`）+ advisory lock，失败返回冲突块清单。**绝不静默覆盖。**

### 3.3 建议 = 真实修订分支（ADR-0004）

建议不存操作列表，存一条 parent 链回 base 的真实修订分支（`suggestions.base_revision_id` + `head_revision_id`）。补丁 = `diff(base树, head树)` 的派生物，随时重算；被要求修改后作者继续向分支提交，**完整往返历史保留**——这是唯一不与「全历史可直观追溯」冲突的建议模型。

接受建议 = 三方块级合并（base / 主线 head / 建议 head）：单侧变更取变更侧；两侧同 blob 取之；两侧异 blob → diff3 文本辅助，再失败进审校人逐块裁决 UI。产出 merge commit（merge_parent = 建议 head）。主线未动则退化为快进合并（最常见路径）。**冲突原子单位是块（段落）**——刻意取舍，比字符级 OT 简单一个数量级，段内精修由 M3 实时协作承接。

### 3.4 行内评论锚定

锚 = `(block_id, 块内偏移, quoted_text 引文, 锚定时 revision_id)`。块靠身份而非位置识别——块移动/前后插入时锚点零成本跟随。块内容变化时 worker 重映射：Step mapping 平移 → 引文模糊匹配回贴 → 仍失败标 `orphaned`，归入「历史评论」并保留引文，永不静默丢弃。**M2 验收红线：典型编辑场景锚点存活率 ≥ 95%，重映射积压 P95 < 60s。**

## 4. 双线权限：统一为「裁决 + 义务」（ADR-0005）

两条线在鉴权层压成同一种 Grant，判定器唯一且返回**裁决**而非布尔：

```ts
type Decision =
  | { allow: true; via: 'role' | 'trust' | 'owner'; obligations: Obligation[] }
  //  义务示例：{type:'enqueue_patrol'} 允许但进巡查队列；{type:'rate_limit'}；{type:'pre_moderation'}
  | { allow: false; reason: DenyReason };  // 结构化拒因 → 前端渲染晋升引导（“再获 3 次建议合入即可解锁”）
```

判定顺序：**制裁一票否决 → 角色线（作用域匹配）→ 所有权特例 → 信任线（受保护级/红线约束）**。

- **角色线**：`role_grants(role, section_id, expires_at)`——superadmin / admin（全局）、section_mod / editor（板块域），任期制到期自动失效。
- **信任线**：TL0 新人 → TL1 成员（评论、行内评论）→ TL2 贡献者（编辑建议、建文章提审）→ TL3 资深（滚动 100 天窗口考核、**可回落**；直编 open 级文档进巡查）→ TL4 共建者（**仅提名+人工授予**，协作编辑）。等级由 `trust_events` 事件流结算（可重放重算），管理员可锁定/手动覆盖。「编辑建议被采纳率」是晋升 TL3 的核心指标。
- **角色专属红线**（信任线永远拿不到）：`doc.publish / doc.unpublish / doc.protect / user.suspend / role.* / system.config`。**晋升给能力，任命给权力。**
- **文档编辑策略**（B 的作者自主权 × C 的保护级合并）：`documents.edit_policy = suggest_only(默认) | open(TL2+直编,巡查) | semi(TL3+直编,巡查) | locked(仅角色线)`。经验类个人文章默认只收建议；作者可主动开放协作；管理员可强制提级保护。
- 所有阈值入 `site_settings` 配置表，**冷启动参数档**单独维护（早期社区数据稀疏，阈值大幅调低，随规模上调）。
- 执行纪律：`domain` 包的 `can()` 是唯一鉴权入口，Server Action / API / worker 全部经它；高危授予与全部拒绝按采样写审计。

## 5. 审批与审校工作流

**统一队列基建**（Stack Overflow review queue 范式，嫁接自 C）：`review_items`（queue 类型 × 主体 × 板块路由 × 优先级，**15 分钟认领租约**过期回池）+ `review_actions`（不可变，**拒稿必填结构化理由码**，翻案率/举报命中率统计的数据源）。审稿人不得审自己的提交（DB 约束 + 鉴权双保险）。

- **发布审批**：审的是「将 published ref 移到修订 X」的请求。`draft → pending → in_review → approved(移 ref)/changes_requested/rejected(理由码)`；已发布文章的更新走同一状态机，审批页展示对当前 published 的**块级增量 diff**。TL4/editor 免审直发但照写审计。回滚 = 创建指回旧树的新修订，历史不删。
- **建议审校**：`open → under_review → merged / changes_requested(分支追加修订后回到 open) / rejected(理由码) / outdated(主线前移冲突, 提供三栏变基 UI) / withdrawn`。**作者对自己文章的建议有审校权（TL2 即可）**——最贴近 Google Docs 直觉且为志愿者省人力；作者失联 14 天自动进板块队列。
- **巡查队列**（M2）：TL2/TL3 直编 open/semi 文档即时生效但进 `edit_patrol`，巡查发现劣化一键回退。事前审批 → 事后巡查的梯度是审核人力可规模化的关键阀门。
- **积压熔断**（冷启动对策）：队列深度超阈值时自动放宽 autoreview 范围（如 TL2+ 的小幅修改免巡查），参数化、可回调。

## 6. 编辑器与协作

- 内容格式：ProseMirror JSON，schema 定义在 `kernel/schema`（编辑器、渲染器、合并算法共用同一份，版本号入库）。节点集刻意收敛：`heading(2-4) paragraph blockquote bullet_list ordered_list code_block figure table callout divider math_block`；marks：`bold italic code link strikethrough highlight`。
- 每个顶层节点带 `attrs.blockId`，编辑器插件注入；分裂时「保留原文多数方」继承原 ID、另一半记 `derived_from`；复制粘贴查重重发；服务端提交时校验唯一性（不变式校验是 kernel 的职责）。
- 实时协作三阶演进：A（M0-M2）单人 + CAS + presence → B 编辑租约 → C（M3）Yjs/Hocuspocus 仅对草稿态开放，定期把 Y.Doc 快照规范化为 `collab_checkpoint` 修订。**修订层才是真理与审计对象，CRDT 只是输入法**；Yjs 二进制是可丢弃缓存。

## 7. 阅读端

- `renderer` 把 PM JSON 渲染为 RSC/HTML，**阅读页零编辑器 JS**；每块输出 `<section id="b-{blockId}">`——行内评论、搜索深链、外部引用三处共用。
- 缓存：发布修订不可变 ⇒ ISR + `revalidateTag(doc:{id})` 仅在 ref 移动时失效；diff/历史页 `Cache-Control: immutable`。
- 中文排版（`.prose-zh` 层）：正文栏宽约 38em、`line-height:1.9`、`text-autospace`/`text-spacing-trim` 渐进增强、避头尾、标点悬挂；**正文零字体下载**（系统栈），仅站名/标题用子集化衬线（<30KB，cn-font-split）——全量中文 webfont 是首屏毒药（嫁接自 B）。
- SEO：语义化 HTML + Article/BreadcrumbList JSON-LD（修订模型让 dateModified 天然可信）、增量 sitemap、RSS、satori 中文 OG 图、canonical 唯一 + slug 改名 301、**修订/建议页 noindex**（防内容重复）、百度主动推送。
- 性能预算：文章页 LCP < 1.8s（4G 中端机）、阅读路径 JS < 60KB gzip、CLS≈0。

## 8. 里程碑

| 里程碑 | 内容 | 验收红线 |
|---|---|---|
| **M0 内核与骨架** ✅ | monorepo、kernel（canon/revision/merge/anchor + 合并矩阵单测）、全量 db schema、better-auth、`can()` 引擎、阅读端渲染 + 中文排版、docker compose | 内核合并矩阵单测全绿；schema 含全部盲区修复字段 |
| **M1 可发布的博客** ✅ | 编辑器（blockId 注入）、working copy、提交/历史/diff/回滚、发布审批状态机 + 队列、评论、Meilisearch 块级搜索、worker、通知 | 创建→审批→发布→改版→diff→回滚全链路演示 |
| **M2 社区底座** ✅ | 行内评论 + 锚点重映射、信任引擎结算、巡查队列 + 协作直编、举报与制裁、审计查看、管理后台 | 锚点存活率 ≥95%；TL 晋升/回落可重放 |
| **M3 建议与审校（产品灵魂）** ✅ | 建议分支全流程、三方合并 + 冲突裁决 UI、三栏变基、审校队列、信任联动 | 「主线前移后接受建议」自动变基与冲突路径双双可演示 |
| **M4 实时协作（当前）** | Hocuspocus 网关、checkpoint 缝合、presence | 断网重连不丢字；Y.Doc 与修订可互相重建 |
| **M5 规模化** | 语义搜索、数据导出（全站内容 CC 协议开放 dump）、透明度报告、备份演练 | RTO<1h，RPO<5min |

排期原则：**M0/M3 不可压缩；UI 可以糙，内核不能糙。**

## 9. 风险登记簿（含评委指出的遗留风险）

| 风险 | 对策 |
|---|---|
| 合并冲突 UI 普通用户看不懂 | 块级粒度压低冲突率；UI 限定「逐块二选一或手改」 |
| 审核人力冷启动 | 信任分流 + autoreview 阀门 + 积压熔断 + 队列工具化；指标看板让瓶颈可见 |
| 信任体系刷分提权 | 速率限制、同源去重、TL3 滚动窗口、TL4 人工背书；M2 起监控异常晋升曲线 |
| 中文 UGC 合规（备案/实名/未成年人） | 审批前置天然兼容「先审后发」；部署区位为待决问题（见 PRD §9），动工前由所有者拍板 |
| Yjs 协作期间细粒度署名丢失 | checkpoint 携带会话参与者集合记入 co-authors；会话内逐字归属明确不承诺 |
| Drizzle 1.0 处于 RC | 锁稳定版本线；schema 全在 db 包一处，升级面收敛 |
| 存储无限增长 | blob 去重 + 窄表 tree；预留冷分区归档与 delta 编码离线迁移路径；永不做「删历史」，只做归档与合规 redaction |
| 领域词典无人维护 | 同义词/新黑话词典作为运营资产入库管理（M1 起），变更走 PR |
| 三方合并丢弃 theirs 侧纯重排 | 已记录的设计取舍（块序以 ours 为准，§3.3）；若实际产生体验问题，M3 在冲突 UI 中提示「对方调整过段落顺序」 |
| slug_history 已建表未接线 | M1 实现改名功能时接通：写入必须 ON CONFLICT (old_slug) DO UPDATE（slug 释放后可再让渡），/a/[slug] 404 前查表 301 |
| 图片仅限站内来源（M0） | 第三方图源是对读者/审稿人的 IP 追踪面，renderer 整体屏蔽；M1 接入站内图床后按白名单放宽 |
