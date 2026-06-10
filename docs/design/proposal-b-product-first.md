# 「求学生涯」开放协作博客系统 —— 架构提案

> 版本：v1.0 · 2026-06 · 定位：以阅读体验与产品迭代速度为第一优先级的修订型内容平台
> 核心立场：这不是一个"博客 + 评论"，而是一个**轻量级 wiki 引擎披着博客的阅读外衣**。修订模型（块级内容 + 全历史 + 补丁式建议）必须从第一天就是数据层的地基，其余一切（权限、工作流、协作）都挂在这个地基上；而读者永远只看到一张干净、快速、排版考究的文章页。

---

## 1. 技术栈选型

| 层 | 选型（主版本） | 胜出理由（对比主要替代品） |
|---|---|---|
| 语言/运行时 | TypeScript 5.x / Node.js 24 LTS | 全栈单语言，1–3 人团队 + AI 辅助下迭代速度最大化；编辑器生态（ProseMirror/Yjs）只在 JS 世界一流。 |
| Web 框架 | **Next.js 16**（App Router + RSC，16.2 LTS 线） | RSC + Cache Components/ISR 是中文内容站 SEO 与首屏性能的最短路径；一个框架同时承载阅读端、编辑端、管理后台。Astro 阅读端更纯粹但重交互编辑器体验割裂；SvelteKit/React Router 7 的编辑器与组件生态明显更薄。 |
| UI | React 19 + Tailwind CSS 4 + shadcn/ui（Radix） | shadcn 源码进仓库、可深度定制阅读排版与设计系统，无组件库锁定。 |
| API 层 | **tRPC 11** + TanStack Query 5 | 端到端类型安全、零 schema 重复，对小团队是数量级的效率差；GraphQL 的灵活性在单一前端场景是纯开销。后期开放 API 时再用 OpenAPI 适配器补 REST。 |
| 数据库 | **PostgreSQL 18**（既定） | 修订模型重度依赖事务、递归 CTE、部分索引、JSONB——PG 全部一流。 |
| ORM | **Drizzle ORM 1.0**（当前 RC 线，GA 后锁定） | SQL-first：修订/合并需要手写复杂查询与显式锁，Drizzle 不挡路；比 Prisma 运行时更轻、迁移即 SQL 可审计。RC 期锁定小版本，风险见第 10 章。 |
| 认证 | **Better Auth 1.x** | 用户表完全落在自己的 PG 里（公益项目数据主权），插件化支持邮箱/OAuth/2FA/封禁；Auth.js 定制阻力大，Lucia 已停止作为框架维护。 |
| 编辑器 | **Tiptap 3**（ProseMirror 系） | ProseMirror 的 schema + transform 模型是实现"建议/批注/追踪修改"最坚实的开源地基，且 Yjs 协作路径成熟；v3 的 **Static Renderer** 允许阅读端零编辑器运行时渲染 JSON。Lexical 生态偏浅，BlockNote 起步快但定制天花板低（而我们的建议模型必然自研）。 |
| 实时协作（M3） | **Yjs 13 + Hocuspocus 3**（自托管） | 事实标准 CRDT + 开源协作后端，不依赖 Tiptap 付费云。 |
| 任务队列 | **BullMQ 5 + Valkey 8** | 通知、搜索索引同步、信任等级计算、邮件全部异步化；Valkey 开源许可证干净。 |
| 搜索 | **Meilisearch 1.x**（内置 charabia 中文分词）；远期 + pgvector | 单二进制 Docker 即起、中文开箱可用、typo 容错与高亮一流；ES+IK 分词更强但运维成本对 1–3 人团队不成比例（详见第 8 章）。 |
| 对象存储 | MinIO（S3 协议） | 自托管图片/附件，协议兼容未来迁云。 |
| 工程 | pnpm 10 + Turborepo 2 + Vitest 3 + Playwright | 标准 monorepo 工具链，缓存构建。 |
| 部署 | Docker Compose + Caddy 2 | 单机自托管即可跑全套（web/worker/PG/Meili/Valkey/MinIO），Caddy 自动 HTTPS + 静态缓存。 |
| 可观测 | Pino + OpenTelemetry + GlitchTip（自托管 Sentry 兼容） | 公益项目零 SaaS 账单。 |

**总架构形态：模块化单体（Modular Monolith）+ 单 worker 进程。** 领域逻辑全部沉淀在框架无关的 `packages/core`，Next.js 只是它的 HTTP/渲染外壳——这是"迭代速度"与"可演进性"两个目标的同时解：今天一个进程跑通一切，明天任何一个 package 都能被拆成独立服务而不动业务代码。

---

## 2. Monorepo 工程结构

```
harublog/
├─ apps/
│  ├─ web/                  # Next.js 16：阅读端(/)、编辑端(/write)、管理后台(/admin)
│  │  ├─ app/(reader)/      # 阅读路由组：RSC 为主，零编辑器 JS
│  │  ├─ app/(studio)/      # 写作/建议/审校路由组：重客户端交互
│  │  ├─ app/(admin)/       # 管理后台路由组
│  │  └─ app/api/trpc/      # tRPC handler（薄壳）
│  └─ worker/               # BullMQ 消费者：索引同步、通知扇出、信任等级计算、邮件、定时任务
├─ packages/
│  ├─ core/                 # ★ 领域层（纯 TS，无框架依赖）：修订引擎、三方合并、
│  │                        #   建议补丁、权限判定 can()、工作流状态机、信任等级规则
│  ├─ db/                   # Drizzle schema、迁移、仓储查询（core 通过接口注入使用）
│  ├─ api/                  # tRPC 路由定义：鉴权中间件 + 参数校验(Zod 4) + 调 core
│  ├─ editor/               # Tiptap 扩展、块 schema、blockId 插件、diff→建议 ops 算法
│  ├─ renderer/             # JSON→HTML 静态渲染（Tiptap Static Renderer）、中文排版后处理、TOC 提取
│  ├─ search/               # SearchAdapter 接口 + Meilisearch 实现（远期可加 pgvector 实现）
│  ├─ auth/                 # Better Auth 配置、会话工具、与 core 权限层的桥接
│  ├─ ui/                   # 设计系统（shadcn 基底 + 阅读排版组件）
│  └─ config/               # 共享 tsconfig / eslint / tailwind preset
└─ infra/
   ├─ docker/               # compose.yaml、Caddyfile、各服务配置
   └─ scripts/              # 备份(pg_dump + MinIO 镜像)、恢复演练、种子数据
```

**关键纪律**：`core` 不允许 import 任何框架；`web` 与 `worker` 不允许绕过 `core` 直接写业务 SQL。模块边界靠 lint 规则（`eslint-plugin-boundaries`）强制，而不是靠自觉。

---

## 3. 核心数据模型：块级内容 + 全历史修订 + 建议补丁

### 3.1 总体决策：采用"裁剪版 git 模型"

明确采用 **commit / tree / blob 三分结构**，但做三处刻意裁剪：

1. **tree 是扁平的**：一篇文章的修订 = 一个有序块列表，不做嵌套 tree。中文经验类文章是线性长文，列表/表格等嵌套结构封装在单个块的 JSON 内部，以"整块替换"为版本粒度。这让三方合并从"树合并"退化为"序列合并"，复杂度下降一个数量级，而粒度对用户仍然直观（"这一段被谁改过"）。
2. **没有用户可见的分支**：建议（suggestion）就是"匿名短分支 + PR"的合体，不暴露 git 的分支心智。
3. **单父提交 + 合并溯源字段**：不做真正的多父 merge commit，合并建议时生成普通修订并记录 `merged_suggestion_id`，可追溯性等价、查询简单得多。

### 3.2 表结构（PostgreSQL，节选核心列）

```sql
-- ≈ git blob：不可变内容块，按内容寻址去重（修订与建议共用同一内容池）
CREATE TABLE blobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_hash  bytea NOT NULL UNIQUE,      -- sha256(canonical_json(content))
  block_type    text  NOT NULL,             -- paragraph|heading|image|code|quote|callout|table|math|embed
  content       jsonb NOT NULL,             -- Tiptap 顶层节点 JSON（见第 6 章）
  text_plain    text  NOT NULL,             -- 抽取纯文本：diff 展示/锚点重定位/搜索
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 块身份：跨修订稳定的 block_id（"这一段"的恒等性载体）
CREATE TABLE block_identities (
  id                  uuid PRIMARY KEY,
  article_id          uuid NOT NULL REFERENCES articles(id),
  created_in_revision uuid NOT NULL          -- 溯源：块诞生于哪次修订
);

-- ≈ git commit：文档修订
CREATE TABLE doc_revisions (
  id                   uuid PRIMARY KEY,
  article_id           uuid NOT NULL REFERENCES articles(id),
  parent_id            uuid REFERENCES doc_revisions(id),   -- 根修订为 NULL
  seq                  int  NOT NULL,        -- 文章内单调递增，UNIQUE(article_id, seq)
  kind                 text NOT NULL,        -- edit|suggestion_merge|revert|moderation
  author_id            uuid NOT NULL,        -- 内容作者（建议合并时 = 建议人，保留署名）
  committer_id         uuid NOT NULL,        -- 执行人（合并建议时 = 审校者）
  merged_suggestion_id uuid REFERENCES suggestions(id),
  title                text NOT NULL,        -- 标题随修订演化
  message              text,                 -- 修订说明（鼓励填写，类 commit message）
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- ≈ git tree：修订的有序块清单（规范化存储，块级历史可索引查询）
CREATE TABLE revision_blocks (
  revision_id uuid NOT NULL REFERENCES doc_revisions(id),
  position    int  NOT NULL,
  block_id    uuid NOT NULL REFERENCES block_identities(id),
  blob_id     uuid NOT NULL REFERENCES blobs(id),
  PRIMARY KEY (revision_id, position),
  UNIQUE      (revision_id, block_id)
);
CREATE INDEX rb_block_history ON revision_blocks (block_id, revision_id);

-- 文章 = 文档身份 + 指针（不含内容）
CREATE TABLE articles (
  id                    uuid PRIMARY KEY,
  section_id            uuid NOT NULL REFERENCES sections(id),
  slug                  text NOT NULL,                -- UNIQUE(section_id, slug)，改名走 slug_history 301
  owner_id              uuid NOT NULL,
  status                text NOT NULL,                -- 见第 5 章状态机
  collab_mode           text NOT NULL DEFAULT 'suggest_only',  -- suggest_only|open_collab
  head_revision_id      uuid REFERENCES doc_revisions(id) DEFERRABLE INITIALLY DEFERRED,
  published_revision_id uuid REFERENCES doc_revisions(id),
  published_snapshot    jsonb,                        -- ★ 读路径物化缓存：发布版全文 JSON
  created_at / updated_at / published_at
);
```

**写读分离的关键一招**：写路径与历史查询走规范化的 `revision_blocks`（"块 X 在哪些修订中变过"是一次索引查询，块级 blame/时间线由此免费获得）；读路径走 `articles.published_snapshot` 物化全文，文章页渲染是 O(1) 单行读。快照在发布/合并事务内同步重建，永不漂移。

去重收益：blob 按 sha256 寻址，一次只改一段话的修订，新增存储 ≈ 一个段落 + 一份块清单；建议的草稿内容也指向同一 blob 池，被合并时零拷贝。

### 3.3 建议（Suggestion）= 针对某一修订的块级补丁

```sql
CREATE TABLE suggestions (
  id                 uuid PRIMARY KEY,
  article_id         uuid NOT NULL,
  author_id          uuid NOT NULL,
  base_revision_id   uuid NOT NULL REFERENCES doc_revisions(id),  -- ★ 补丁基底
  status             text NOT NULL,   -- 状态机见第 5 章
  title text, description text,
  merged_revision_id uuid REFERENCES doc_revisions(id),
  created_at / updated_at
);

CREATE TABLE suggestion_ops (
  suggestion_id   uuid NOT NULL REFERENCES suggestions(id),
  seq             int  NOT NULL,
  op              text NOT NULL,   -- replace | insert_after | delete | move_after
  block_id        uuid,            -- replace/delete/move 的目标块
  anchor_block_id uuid,            -- insert_after/move_after 的锚点块（NULL = 文首）
  old_blob_id     uuid,            -- 基底中该块的 blob —— 三方合并的校验依据
  new_blob_id     uuid,            -- 新内容，指向共享 blob 池
  PRIMARY KEY (suggestion_id, seq)
);
```

**生成方式（刻意的简化）**：建议者在普通编辑器里直接改一份基于 `base_revision` 的副本，提交时由 `packages/editor` 做**块级 diff**（按 blockId 对齐 → 内容哈希比较 → LIS 检测移动）自动生成 ops。不做"实时 track-changes 标记"——那是 ProseMirror 世界出名的深坑，而 diff-on-submit 用 20% 的成本覆盖 95% 的产品价值。审校 UI 上，`replace` 操作再用 `text_plain` 做字符级 diff 高亮展示，**存储统一在块粒度，展示下钻到字符粒度**。

**合并 = 块粒度三方合并**，在一个事务内执行：

```
对每个 op（base = 建议基底，head = 当前最新修订）：
  replace/delete:  head 中该块的 blob == old_blob      → 干净应用
                   head 中该块的 blob == new_blob      → 已被等价修改，跳过
                   块已被删除或 blob 三方各异           → 冲突
  insert_after:    锚点块仍存在 → 应用；锚点被删 → 退化为"按原相对位置插入"并标记弱冲突
全部干净 → 生成 kind='suggestion_merge' 的新修订（author=建议人，committer=审校者）
存在冲突 → 建议置为 outdated，列出冲突块；建议人一键"变基"（系统自动重放无冲突 ops 到新基底，
           冲突块进入并排对比编辑），重新进入审校
```

### 3.4 并发编辑冲突的四层防线

1. **乐观锁提交（根本机制）**：所有产生修订的写入走同一 commit API，必须携带 `base_revision_id`；事务内 `SELECT … FOR UPDATE` 锁文章行，校验 `head_revision_id == base`，通过则追加修订并 CAS 推进 head。
2. **服务端自动变基**：校验失败时，若提交者与中间修订触碰的是**不相交的块集合**，服务端自动按块三方合并、静默成功；有交集才返回 409 + 冲突块清单，前端给出块级并排合并 UI。
3. **编辑在场租约（事前预防）**：Valkey 中 per-article 心跳租约，进入编辑器即提示"XX 正在编辑本文"，从源头减少撞车（维基百科同款策略）。
4. **草稿不产生修订**：自动保存写入 `drafts(user_id, article_id, base_revision_id, doc jsonb)`，只有显式"提交"才进修订流水线，历史不被自动保存污染。M3 的 Yjs 实时协作（第 6 章）最终让"协作编辑会话"内部彻底无冲突，提交时仍走同一 commit API——**修订模型始终是唯一事实源，CRDT 只是会话层**。

### 3.5 行内评论的锚定

```sql
CREATE TABLE comments (
  id uuid PRIMARY KEY, article_id uuid NOT NULL, author_id uuid NOT NULL,
  parent_id uuid REFERENCES comments(id),          -- 楼中楼
  body jsonb NOT NULL, body_text text NOT NULL,    -- 受限富文本
  anchor_block_id uuid,                            -- NULL = 文章级评论
  anchor jsonb,  -- W3C TextQuoteSelector 风格：{revision_id, quote, prefix, suffix, start, end}
  status text NOT NULL DEFAULT 'visible',          -- visible|pending|hidden|deleted
  created_at / edited_at
);
```

锚点 = **块身份 + 引文选择器**双保险：块内容被修改后，先在该块新 `text_plain` 内做 quote 模糊重定位；失败则降级为"挂在块上"；块被删除则标记 orphaned 收纳进文末"历史批注"区。锚定到 block_id 而非全文偏移，使绝大多数修订不影响无关位置的批注。

### 3.6 其余支撑表（列名从略）

`users`、`sections`、`role_assignments(user_id, role, section_id NULL)`、`user_stats`（信任等级指标）、`review_requests` + `review_events`（第 5 章）、`notifications`、`reactions`、`media`、`slug_history`、`audit_log(actor, action, subject_type/id, payload jsonb, ip, created_at)`——append-only、按月分区、管理后台可检索。

---

## 4. 双线权限模型：统一到 Capability 判定

### 4.1 模型

两条线在**同一个能力集合**上汇流：最终权限 = 角色授予的能力（自上而下、可带板块作用域） ∪ 信任等级授予的能力（自下而上、全站生效） ∪ 资源所有权能力，再减去处罚（禁言/封禁）。**所有调用点只问 `can(user, capability, resource)`，永远不直接问角色或等级**——这是两线合一且未来可加新线（如"导师认证"）的关键。

### 4.2 能力清单

| Capability | 信任线解锁 | 角色线授予（作用域内） |
|---|---|---|
| `read` / `react` | TL0 | — |
| `create_article`（创建并提交审批） | TL0 | — |
| `comment` | **TL1** | editor+ |
| `inline_comment` | **TL2** | editor+ |
| `suggest_edit` | **TL3** | editor+ |
| `collab_edit`（直接协作编辑他人开放协作的文章） | **TL4** | editor+ |
| `publish_direct`（自己文章免前置审批，转后置抽查） | TL4 | editor+ |
| `review_article` / `review_suggestion` | — | editor+ |
| `feature_content` / `manage_section` | — | section_moderator+ |
| `manage_roles_in_section` / `manage_users` / `set_trust_override` | — | admin+ |
| `view_audit_log` / `system_config` | — | admin / superadmin |

信任等级（参考 Discourse，但指标换成贡献质量导向）：TL0 新人 → TL1 基础（注册满 N 天 + 有效阅读）→ TL2 成员（≥3 篇评论被赞/无违规）→ TL3 熟练（≥1 篇文章发布 或 ≥5 条评论精选）→ TL4 资深（≥3 篇发布 + ≥5 条建议被合并，**管理员确认制**）。指标由 worker 夜间任务从 `user_stats` 重算，升降级写审计日志；`users.trust_override` 支持手动锁定/降级。

### 4.3 判定伪代码（位于 `packages/core/authz`）

```ts
function can(user: User, cap: Capability, res?: Resource): boolean {
  if (!user || user.banned) return cap === 'read' && !res?.restricted;
  if (user.roles.has('superadmin')) return true;

  const caps = new Set<Capability>([
    ...trustCaps(effectiveTrustLevel(user)),          // 自下而上线
    ...user.roleAssignments
       .filter(r => r.sectionId == null || r.sectionId === res?.sectionId)
       .flatMap(r => roleCaps(r.role)),               // 自上而下线（板块作用域）
    ...ownerCaps(user, res),                          // 自己的草稿可编辑/撤回
  ]);
  for (const s of activeSanctions(user)) s.revoke(caps);   // 禁言剥夺 comment 系能力

  if (!caps.has(cap)) return false;
  return resourceGuard(cap, user, res);   // 资源级守卫：
  // - collab_edit 要求 article.collab_mode === 'open_collab'
  // - review_* 不得审自己创建的对象（res.authorId !== user.id）
  // - 板块锁定/归档文章拒绝一切写能力
}
```

tRPC 中间件统一注入：`procedure.use(requireCap('suggest_edit', loadArticle))`，UI 端用同一份 `can()`（core 同构）做按钮显隐，杜绝前后端权限逻辑分叉。

---

## 5. 审批与审校工作流

两类对象（文章、建议）共用一套审校基础设施：`review_requests(subject_type, subject_id, state, assignee_id)` + `review_events`（每次动作含意见，构成讨论流水 + 审计）。板块管理员/编辑按板块作用域认领，支持指派与超时提醒（worker 定时扫描）。

### 5.1 新文章状态机

```
                 提交审批                通过(发布)
  draft ───────────────▶ in_review ───────────────▶ published
    ▲                      │    │                      │
    │  驳回并要求修改        │    │ 拒绝                 │ 归档/下线(作者或管理员)
    └── changes_requested ◀┘    ▼                      ▼
            │              rejected(可申诉一次)      archived
            └── 修改后重新提交 ──▶ in_review
```

- `published` 后的再编辑：作者本人 / TL4 / 编辑 → 直接产生新修订即时生效（后置抽查 + 全程可回滚，`kind='revert'` 一键回滚到任意历史修订）；低信任协作者 → 只能走建议通道。**发布门槛前置审核 + 修订后置监督**，平衡质量与维基式开放性。

### 5.2 编辑建议状态机

```
  open ──审校认领──▶ under_review ──批准──▶ merging ──事务成功──▶ merged (终态)
   ▲ ▲                  │   │
   │ │  要求修改          │   │ 拒绝 ──▶ rejected (终态)
   │ └─ changes_requested◀┘
   │         │ 建议人修改(ops 重算)
   │         ▼
   └──────  open
   任意非终态 ──head 推进导致冲突──▶ outdated ──建议人一键变基──▶ open
   建议人主动 ──▶ withdrawn (终态)
```

merge 阶段即第 3.3 节的三方合并事务；`merged` 修订署名建议人、记录审校者，双方贡献都进入 `user_stats` 喂养信任等级——**工作流与信任体系闭环**。

---

## 6. 编辑器与协作方案

- **框架**：Tiptap 3 自建块 schema。顶层节点即"块"，自研 `blockId` 插件在节点创建时注入 UUID attr 并保证复制粘贴时重新生成。块类型首发集合：段落、标题(2/3级)、图片(带题注)、代码、引用、提示框(callout)、表格、数学公式(KaTeX)、视频嵌入。
- **内容格式**：存储单位是"单块 Tiptap JSON"（即 blob.content），文档 = 按 `revision_blocks` 顺序拼装。示例：

```json
{ "type": "paragraph", "attrs": { "blockId": "01890f…" },
  "content": [{ "type": "text", "text": "高三一年我最大的教训是…" }] }
```

- **三种贡献模式同一编辑器**：直接编辑（commit API）/ 建议模式（提交时 diff→ops，第 3.3 节）/ 行内评论（阅读页划词触发，不进编辑器）。编辑器 bundle 与阅读端严格隔离（路由组分割），读者永远不下载 ProseMirror。
- **实时协作演进路径（明确三阶段）**：
  1. **M0–M2 单写者 + 租约**：在场提示 + 乐观锁 + 自动变基，已足够支撑"低频协作"；
  2. **M3 Yjs + Hocuspocus 3**：对 `open_collab` 文章开实时房间（TL4/编辑可进），光标在场、离线合并；房间内定期/手动"存档点"将 Y.Doc 快照导出为块列表走 commit API 产生修订；
  3. **恒定不变式**：Yjs 文档是**会话态**，PG 修订链是**唯一持久事实源**。这保证实时层可以随时替换/降级，历史追溯不依赖 CRDT 内部结构。

---

## 7. 阅读端体验：渲染、中文排版、SEO、性能

**渲染管线**：`published_snapshot` → Tiptap **Static Renderer**（服务端 JSON→HTML，零编辑器运行时）→ RSC 输出 → 整页缓存（Cache tag `article:{id}`，发布/合并时 `revalidateTag` 精准失效）。行内评论高亮、划词工具条、目录滚动定位是仅有的三个客户端岛，懒加载且不阻塞 LCP。评论区首屏服务端渲染前 N 条（SEO 可索引），余下分页客户端加载。

**中文排版（renderer 包统一处理，存储层不污染）**：
- 正文 17px/手机 16px，行高 1.9，段距 0.9em，行宽约 38em（每行 36–40 汉字）；`text-align: justify` + `text-justify: inter-character`；
- 渲染时后处理：中西文间自动加间隙（优先用 CSS `text-autospace`/`text-spacing-trim`，按 2026 年浏览器支持度渐进增强，不支持则注入 hair-space）、引号统一、标点悬挂（heti 式 CSS 方案）；
- 字体零下载策略：正文走系统栈（PingFang SC / HarmonyOS Sans / Noto Sans CJK），仅站名与 H1 用 cn-font-split 子集化的思源宋体（< 30KB），中文 webfont 全量包是首屏毒药；
- 代码块/数学公式 SSR 高亮与排版（Shiki + KaTeX 服务端渲染），无客户端闪烁。

**SEO**：语义化 HTML（article/section/heading 层级）；Metadata API 输出 title/description/canonical；JSON-LD `Article` + `BreadcrumbList`；URL `/{section-slug}/{article-slug}`，slug 变更经 `slug_history` 301；动态 sitemap.xml + 全站/分板块 RSS；`next/og` 生成中文 OG 卡片图；修订历史页、建议页加 `noindex` 防内容重复。

**性能预算**：文章页 LCP < 1.5s（4G 中端机）、首屏 HTML < 50KB gzip、阅读路由客户端 JS < 80KB。Caddy 层对匿名访客做整页缓存（登录态绕过），图片经 MinIO + next/image 出 AVIF/WebP 与响应式尺寸。

---

## 8. 中文搜索方案

**初期（M1 起）：Meilisearch 1.x，文章级索引。**
- charabia 内置 jieba 系中文分词，开箱即用；typo 容错、前缀即时搜索、中文高亮、按板块/标签/作者过滤、自定义排序（质量分 = 精选/收藏加权）；
- 索引文档 = `{id, title, headings[], text(各块 text_plain 拼接), section, tags, author, published_at, quality_score}`，标题/小标题字段加权；
- 同步：发布/更新/下线事件 → BullMQ → worker 增量推送，每夜全量校对一次；搜索经 `packages/search` 的 `SearchAdapter` 接口隔离，业务代码不知道 Meili 存在；
- PG `pg_trgm` 兜底管理后台的精确检索（用户、审计日志），不依赖搜索服务可用性。

**远期（M4+）：混合检索。**
- pgvector + bge-m3（或当期最优中文开源 embedding）做语义索引：补足"换种说法搜不到"（学生搜"考前焦虑睡不着"应命中"应试心态调整"），并直接产出"相关文章"推荐；
- 检索融合：Meili 关键词召回 + 向量召回 → RRF 重排，仍藏在同一 SearchAdapter 后；
- 仅当数据量与查询复杂度真正越过 Meilisearch 能力线（千万级文档、复杂聚合）才考虑 Elasticsearch+IK——按本项目体量，大概率永远不需要。
- 已知短板提前声明：charabia 自定义词典能力弱，教育领域专名（"强基计划""3+1+2"）分词可能欠佳，用 Meili 同义词表 + 标题前缀匹配缓解。

---

## 9. 演进路线图

| 里程碑 | 周期(估) | 交付内容 | 验收红线 |
|---|---|---|---|
| **M0 骨架** | 6 周 | Monorepo + Docker Compose 全套；Better Auth 注册登录；板块/文章 CRUD；**修订模型(blob/revision/revision_blocks/commit API)第一天落地**；Tiptap 基础块编辑器 + 草稿；文章审批流（draft→in_review→published）；SSR 阅读页 + 排版 v1 + sitemap/RSS；audit_log | 任何内容写入都已经过 commit API；回滚可用 |
| **M1 社区基础** | +6 周 | 评论 + 行内评论（锚定/重定位/orphan 处理）；通知中心 + 邮件；Meilisearch 上线；个人主页与贡献记录；信任等级（先手动授予 + 指标采集）；OG 图、SEO 完整化 | 行内评论在文章经历 ≥5 次修订后存活率 > 95% |
| **M2 协作内核** | +8 周 | 建议补丁全链路（diff→ops→审校 UI 字符级高亮→三方合并→变基）；建议审校状态机 + 审校工作台；信任等级自动升降；块级历史 UI（每块时间线/blame、修订对比页）；处罚与举报 | 不相交块的并发提交 100% 自动合并；冲突路径有完整 UI |
| **M3 实时协作** | +8 周 | Yjs + Hocuspocus 房间（open_collab 文章）；在场光标；存档点→修订管线；移动端编辑体验打磨；管理后台数据看板 | 协作会话崩溃不丢已存档修订 |
| **M4 增长与开放** | 持续 | pgvector 语义相关推荐；混合搜索；开放只读 REST API + webhook；性能与缓存深化；专题/合集策展功能 | — |

排序逻辑：**修订模型必须在 M0**（事后改造存储模型等于重写）；行内评论先于建议（验证锚定基础设施）；实时协作最后（它只是体验增强，乐观锁阶段产品已完整可用）。

---

## 10. 主要风险与取舍声明

1. **复杂度前置（最大取舍）**：M0 就背上 git 式修订模型，骨架期慢 2–3 周。接受：这是本产品区别于"又一个博客"的唯一护城河，事后迁移成本是毁灭性的；作为对冲，tree 扁平化、单父提交、diff-on-submit 三处裁剪已把复杂度压到一人可维护。
2. **块粒度版本的表达力上限**：块内小改也是整块新 blob，"同块并发小改"无法自动合并（按冲突处理）。接受：字符级 OT/步进存储的复杂度与收益严重不匹配；展示层字符级 diff + M3 实时协作覆盖了主要痛点。
3. **Tiptap 开源核心 + 商业云的开-闭风险**：评论/建议/版本是其付费云功能，我们全部自研于自有模型之上，仅依赖其 MIT 编辑器内核与 Static Renderer；若生态恶化，ProseMirror 原生层始终在脚下。
4. **Next.js 深耦合**：缓存语义与 RSC 是 Vercel 主导的。对冲：领域逻辑 100% 在 `core/db` 包，web 只是渲染壳；自托管路径（standalone 输出 + Caddy 缓存）从第一天验证，不依赖 Vercel 平台特性。
5. **Drizzle 1.0 处于 RC**：API 仍可能微调。对冲：锁版本 + 仓储层封装查询，升级影响面受控；若 GA 跳票，0.x→1.x 迁移指南成熟。
6. **中文分词质量天花板**（见第 8 章）：charabia 不可深度定制。接受为初期取舍，语义检索在 M4 补位。
7. **合规与部署区位（需要尽早拍板的非技术决策）**：面向中国学生的 UGC 平台若部署境内需 ICP 备案 + 内容安全义务（先审后发恰好契合，但需补敏感词过滤与值守流程）；境外部署则牺牲访问速度与传播。架构上两者皆可（全自托管、无区域锁定依赖），但运营策略必须先行决定。
8. **公益项目的人的风险**：1–3 人团队，审校与运维都可能断档。对冲：审批超时自动提醒与升级、每日自动备份 + 季度恢复演练脚本（infra/scripts）、全部基础设施单机 Compose 可重建、文档即代码。
9. **明确不做的事**：不做微服务、不做自建移动 App（响应式 Web + PWA）、不做多语言界面（中文优先）、不在 M3 前做实时协作。每一项都是为了把有限的工程力压在"修订模型 + 阅读体验"这两个生死线上。

---

### 附：选型版本核实来源（2026-06）

- Next.js 16.2 LTS：[endoflife.date/nextjs](https://endoflife.date/nextjs)、[Next.js 16 发布说明](https://nextjs.org/blog/next-16)
- Drizzle ORM 1.0（RC 阶段）：[Drizzle v1 Roadmap](https://orm.drizzle.team/roadmap)、[GitHub Releases](https://github.com/drizzle-team/drizzle-orm/releases)
- Tiptap 3 稳定版与 Static Renderer：[Tiptap 3.0 is stable](https://tiptap.dev/blog/release-notes/tiptap-3-0-is-stable)、[What's new in Tiptap V3](https://tiptap.dev/docs/resources/whats-new)