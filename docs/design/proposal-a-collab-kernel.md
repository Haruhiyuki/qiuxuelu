# 求学生涯协作博客系统 · 架构提案

> 定位声明：本系统的本质是一个**带审校工作流的中文 wiki 引擎 / 版本化内容数据库**。块级修订模型、建议补丁模型、冲突处理的正确性是第一公民；Web 框架、UI、增长功能都是围绕这个「协作内核」的外壳。本提案所有决策以此为最高优先级。
>
> 版本判断基准日：2026 年 6 月（关键版本已联网核验，来源见文末附录）。

---

## 1. 技术栈选型（结论制）

| 层 | 选型（主版本） | 为何胜出 |
|---|---|---|
| 运行时 | **Node.js 24 LTS + TypeScript 5.9** | 内核（修订/合并算法）必须与编辑器（ProseMirror）共享同一份 schema 与同构代码，全栈 TS 是唯一能做到「一份文档模型、前后端复用」的方案，排除 Go/Rust 后端拆分。 |
| Web 框架 | **Next.js 16.2（LTS，App Router + RSC，自托管 node 运行时）** | 读端 SEO/ISR/流式渲染一流且现为 LTS 版本；胜过 Remix/React Router 7（生态与 RSC 成熟度）与 SvelteKit（编辑器生态绑定 React）。**不上 Vercel**，以 `next start` + Docker 自托管。 |
| 前端 | **React 19.x + Tailwind CSS 4.1 + shadcn/ui（Radix 基座）** | Tiptap/ProseMirror 的 React 绑定最成熟；shadcn 提供可完全自有化的组件源码，符合公益项目长期可控诉求。 |
| 编辑器 | **Tiptap 3.26（ProseMirror 内核）** | ProseMirror 的「带严格 schema 的树状 JSON 文档 + Steps 事务模型」是本系统块级修订模型的天然载体；Tiptap 3 提供工程化封装与 Yjs 一等支持。胜过 Lexical（协作与版本生态弱）、Slate（维护与稳定性）。详见 §6。 |
| ORM | **Drizzle ORM 1.0（rc，stable 临近，锁版本）** | 修订存储大量依赖手写 SQL（递归 CTE、jsonb 操作、CAS 更新），Drizzle 是「SQL 透明」的类型安全层；Prisma 的查询抽象在这类内核型 schema 上是阻力而非助力。 |
| 数据库 | **PostgreSQL 18.4** | 题设给定；jsonb + 事务性 + 行级锁恰好覆盖「内容数据库」全部需求。**所有事实以 PG 为唯一真相源**。 |
| 缓存/队列 | **Valkey 8 + BullMQ 5** | Valkey 取 Redis 协议兼容且 BSD 许可，对公益自托管最干净；BullMQ 承载索引同步、通知扇出、信任等级结算等异步任务。 |
| 搜索 | **Meilisearch 1.38** | 内置 charabia 中文分词（jieba 词典），单二进制 Docker 部署，开箱即用的中文体验碾压 PG 原生 FTS；比 Elasticsearch 轻一个数量级，匹配 1–3 人团队。详见 §8。 |
| 实时协作（M4） | **Yjs 13 + y-prosemirror + Hocuspocus 3** | OT vs CRDT 的结论见 §6.3：实时层选 CRDT（Yjs），持久层坚持提交制。 |
| 认证 | **Better Auth 1.x** | TS 原生、完全自托管、邮箱+OAuth+会话管理一体；Auth.js 处于低维护状态，Clerk/Logto 引入外部依赖不符公益自托管定位。 |
| 校验 | **Zod 4** | 与 Drizzle/服务端动作共享 schema，单一校验事实源。 |
| 工程 | **pnpm 10 + Turborepo 2.5 + Vitest 3 + Playwright 1.x** | monorepo 标准答案；内核算法（合并/diff）必须有重度单测，Vitest 速度与 TS 体验最佳。 |
| 部署 | **Docker Compose + Caddy 2.10（自动 HTTPS + 静态缓存）** | 一台 4C8G VPS 即可起全栈；不排斥后续迁托管 PG。 |

**显式不选**：微服务（团队规模不匹配）、tRPC/GraphQL（Next 内直接调用领域服务，无网络跳；对外仅暴露只读 REST）、MongoDB/ES（PG 单一真相源原则）、自研编辑器（自杀行为）。

---

## 2. Monorepo 工程结构

```
harublog/
├─ apps/
│  ├─ web/                  # Next.js 16：读端 + 写端 + 管理后台 + 公开只读 API
│  │  ├─ app/(read)/        # 阅读端路由（RSC/ISR，零客户端 JS 优先）
│  │  ├─ app/(write)/       # 编辑器、建议、审校工作台（客户端组件区）
│  │  ├─ app/(admin)/       # 管理后台
│  │  └─ app/api/           # 只读 REST（RSS/sitemap/公开 API）+ webhook
│  ├─ worker/               # BullMQ 常驻进程：搜索索引、通知扇出、信任结算、敏感词预检
│  └─ collab/               # （M4 才创建）Hocuspocus 协作网关，独立可水平扩展
├─ packages/
│  ├─ kernel/               # ★ 协作内核（本系统的心脏）
│  │  ├─ schema/            #   ProseMirror 文档 schema（唯一事实源，版本化）
│  │  ├─ canon/             #   规范化序列化 + sha256 内容寻址
│  │  ├─ revision/          #   manifest 构建、commit 创建、块级 diff
│  │  ├─ merge/             #   三方块级合并、diff3 文本辅助合并、冲突报告
│  │  └─ anchor/            #   行内锚点重映射（Step mapping + 引文回退匹配）
│  │  └─ ⚠ 纯函数、零 IO、零框架依赖，100% 单测覆盖合并矩阵
│  ├─ db/                   # Drizzle schema、迁移、仓储实现（kernel 的持久化适配器）
│  ├─ domain/               # 应用服务：权限判定、工作流状态机、通知、审计（依赖 kernel+db）
│  ├─ editor/               # Tiptap 扩展集 + 建议模式/评论 UI 插件（依赖 kernel/schema）
│  ├─ renderer/             # ProseMirror JSON → HTML/RSC 渲染器（读端、RSS、OG 图复用）
│  ├─ search/               # Meilisearch 索引映射 + 同步逻辑
│  ├─ ui/                   # 设计系统组件（shadcn 派生）
│  └─ config/               # tsconfig / eslint / 共享常量
├─ infra/
│  ├─ docker-compose.yml    # web + worker + postgres + valkey + meilisearch + caddy
│  └─ caddy/ backup/        # 反代配置、pg_dump + WAL 归档脚本
└─ turbo.json / pnpm-workspace.yaml
```

**依赖方向铁律**：`kernel ← db ← domain ← apps`；`kernel` 不得 import 任何上层。这是「避免微服务但保持可拆分」的具体落地——未来若需把协作网关或搜索拆出去，切口已经存在。

---

## 3. 核心数据模型：块级内容 + 全历史修订 + 建议补丁

### 3.1 总体结论：采用类 git 模型，但做两处关键改造

| git 概念 | 本系统对应 | 改造点 |
|---|---|---|
| blob | `blobs`（单块内容，内容寻址，不可变） | 内容是规范化 ProseMirror 节点 JSON，而非字节流 |
| tree | `revisions.manifest`（有序块清单） | **扁平单层，不递归**——文档 = 顶层块序列，列表/表格整体算一个块 |
| commit | `revisions`（含 parent / merge_parent） | 同 git |
| ref/branch | `document_refs`（`draft` / `published` / `suggestion/<id>`） | 「发布」= 移动 `published` ref，审批即审「ref 移动请求」 |
| —（git 没有） | **`blocks` 稳定块身份** | git 靠路径+相似度猜 rename；我们给每个块发不可变 UUID，移动/改写的追溯是精确事实而非启发式。这是相对 git 的核心改进，行内评论锚定、块级历史、合并判定全部受益 |

### 3.2 表结构（DDL 级）

```sql
-- 板块与文档身份 ---------------------------------------------------------
CREATE TABLE sections (
  id uuid PRIMARY KEY, slug text UNIQUE NOT NULL,
  name text NOT NULL, parent_id uuid REFERENCES sections(id),
  stage text NOT NULL CHECK (stage IN ('junior','senior','college','general'))
);

CREATE TABLE documents (
  id uuid PRIMARY KEY,
  section_id uuid NOT NULL REFERENCES sections(id),
  slug text UNIQUE NOT NULL,
  owner_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'draft',     -- §5 状态机
  schema_version int NOT NULL,              -- ProseMirror schema 版本
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ① 内容寻址 blob：单个块的不可变快照 ------------------------------------
CREATE TABLE blobs (
  hash bytea PRIMARY KEY,            -- sha256(canonicalize(content))
  content jsonb NOT NULL,            -- 单块 ProseMirror 节点 JSON（键序规范化）
  text_plain text NOT NULL,          -- 抽取纯文本：diff 展示 / 搜索 / 锚点回退匹配
  size_bytes int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- 同内容天然去重：百次修订只改一个块，其余块零额外存储

-- ② 块的稳定身份（跨修订不变）--------------------------------------------
CREATE TABLE blocks (
  id uuid PRIMARY KEY,                       -- 行内评论、块历史的锚定对象
  document_id uuid NOT NULL REFERENCES documents(id),
  type text NOT NULL,                        -- paragraph/heading/code/figure/...
  born_revision_id uuid NOT NULL             -- 出生修订
);

-- ③ 修订 = commit --------------------------------------------------------
CREATE TABLE revisions (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES documents(id),
  parent_id uuid REFERENCES revisions(id),
  merge_parent_id uuid REFERENCES revisions(id),   -- 合并建议时的第二父
  author_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL,        -- edit | merge_suggestion | rollback | collab_checkpoint
  message text,
  manifest jsonb NOT NULL,   -- 有序数组 [[block_id, blob_hash_hex], ...] = git tree 快照
  manifest_hash bytea NOT NULL,   -- sha256(manifest)，相同内容状态可被识别
  schema_version int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON revisions (document_id, created_at);

-- ④ 修订变更明细（物化的逐块 diff，git 不存而我们存，换块级可追溯性）------
CREATE TABLE revision_changes (
  revision_id uuid NOT NULL REFERENCES revisions(id),
  block_id uuid NOT NULL REFERENCES blocks(id),
  change text NOT NULL CHECK (change IN ('add','modify','remove','move')),
  old_blob bytea, new_blob bytea,
  old_pos int, new_pos int,
  PRIMARY KEY (revision_id, block_id)
);
CREATE INDEX ON revision_changes (block_id);   -- 「这个段落的全部历史」一查即得

-- ⑤ refs：可变指针，全系统唯一的「可变状态」------------------------------
CREATE TABLE document_refs (
  document_id uuid NOT NULL REFERENCES documents(id),
  name text NOT NULL,                -- 'draft' | 'published' | 'suggestion/<uuid>'
  revision_id uuid NOT NULL REFERENCES revisions(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, name)
);
```

**存储量评估**：manifest 为 jsonb 整存（200 块文档 ≈ 14KB/修订，TOAST 自动压缩）；`revision_changes` 行数 = 实际变更数而非 块数×修订数。千次修订的长文档 ≈ 15MB 量级，PG 毫无压力；远期冷修订可归档分区。

**自动保存不产生修订**：编辑器自动保存写入可变的 `working_copies(document_id, user_id, pm_json, base_revision_id)` 表（每人每文档一行）；只有「提交版本 / 发起建议 / 申请发布」时才 commit，杜绝修订垃圾。

### 3.3 建议（suggestion）= 分支，补丁 = diff(base, head)

**结论：建议不存「操作列表」，存一条真实的修订分支。**补丁是两个 manifest 的派生物，随时可重算、天然块级、与正式编辑共用全部内核代码。

```sql
CREATE TABLE suggestions (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES documents(id),
  author_id uuid NOT NULL REFERENCES users(id),
  base_revision_id uuid NOT NULL REFERENCES revisions(id),  -- 基于哪个修订提出
  head_revision_id uuid NOT NULL REFERENCES revisions(id),  -- 分支头（parent 链回 base）
  status text NOT NULL DEFAULT 'open',          -- §5 状态机
  conflicted boolean NOT NULL DEFAULT false,    -- 主线前进后自动重判
  note text,                                    -- 作者说明「为什么这样改」
  merged_revision_id uuid REFERENCES revisions(id),
  resolved_by uuid, resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

- 展示补丁：`diff = compareManifests(base, head)` → 块级 add/modify/remove/move；modify 块再做块内细粒度 diff（基于 `text_plain` 的字符级 diff + 节点属性 diff）渲染成「红删绿增」。
- 作者可在被要求修改后继续向分支提交（`head_revision_id` 前移），完整往返历史保留。

**接受建议 = 合并（kernel/merge 的三方块级合并）**：

```
对每个 block_id，比较 (base, mainline_head, suggestion_head) 三个 blob：
  仅一侧变更            → 取变更侧
  两侧变更且 blob 相同   → 取之（殊途同归）
  两侧变更且 blob 不同   → 冲突块：先尝试 diff3 文本合并辅助；
                           失败则进入审校人逐块二选一/手工编辑界面
块序冲突（双方都移动/插入）→ 以主线序为准，建议新增块按相对锚块就近插入
产出 merge commit：parent=mainline_head, merge_parent=suggestion_head
```

若主线自 base 后未动 → 退化为零冲突快进式合并（最常见路径）。

### 3.4 并发编辑冲突防护（实时协作上线前）

三道防线，由便宜到昂贵：

1. **在场提示（软）**：编辑器心跳写 Valkey（`editing:{doc}:{block} → user`，TTL 30s），他人编辑同块时 UI 实时提示「××正在编辑本段」，把大多数冲突消灭在发生前。
2. **块级自动变基（中）**：提交 commit 时携带 `base_revision_id`，服务端发现 ref 已前移，则在事务内做三方合并；动的不是同一批块 → 自动变基成功，静默落盘。
3. **CAS + 显式冲突（硬）**：`UPDATE document_refs SET revision_id=$new WHERE name='draft' AND revision_id=$expected`（外加 `SELECT ... FOR UPDATE` 串行化同文档提交）。变基遇到同块冲突 → 返回 409 + 冲突块清单，前端展示双版本供提交者就地解决。**绝不出现静默覆盖或后写胜出。**

### 3.5 行内评论锚点

```sql
CREATE TABLE comments (
  id uuid PRIMARY KEY, document_id uuid NOT NULL,
  author_id uuid NOT NULL, parent_id uuid REFERENCES comments(id),
  kind text NOT NULL CHECK (kind IN ('doc','inline','review')),
  body jsonb NOT NULL, status text NOT NULL DEFAULT 'visible',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE comment_anchors (
  comment_id uuid PRIMARY KEY REFERENCES comments(id),
  block_id uuid NOT NULL REFERENCES blocks(id),   -- 第一锚：稳定块身份
  revision_id uuid NOT NULL,                      -- 锚定时所见修订
  start_offset int NOT NULL, end_offset int NOT NULL,
  quoted_text text NOT NULL,                      -- 第二锚：被评论原文引文
  state text NOT NULL DEFAULT 'live'              -- live | remapped | orphaned
);
```

重映射策略：新修订落盘时，worker 对受影响锚点先用 ProseMirror Step mapping 平移偏移；块内容大改导致映射失效时，用 `quoted_text` 在新 blob 的 `text_plain` 中模糊匹配回贴；仍失败 → `orphaned`，归入「历史评论」区并保留引文，**永不丢失**。

---

## 4. 双线权限模型：统一 capability 判定层

### 4.1 两条线

**角色线（自上而下，指派制，可带板块作用域）**

```sql
CREATE TABLE role_grants (
  id uuid PRIMARY KEY, user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('superadmin','admin','section_mod','editor')),
  section_id uuid REFERENCES sections(id),   -- NULL = 全站作用域
  granted_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
```

**信任线（自下而上，事件累积 + 等级缓存，参考 Discourse）**

```sql
CREATE TABLE trust_events (  -- 审计友好：等级永远可由事件流重算
  id bigserial PRIMARY KEY, user_id uuid NOT NULL,
  delta int NOT NULL, reason text NOT NULL,      -- article_published / suggestion_accepted / flag_upheld(-) ...
  ref_type text, ref_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
-- users.trust_level int 为缓存列，worker 夜间结算 + 关键事件即时结算
CREATE TABLE user_restrictions (  -- 负向覆盖：板块禁言/降权，优先级最高
  user_id uuid, section_id uuid, denied_caps text[], until timestamptz,
  PRIMARY KEY (user_id, section_id)
);
```

### 4.2 能力清单（节选核心）

| capability | 信任线最低 TL | 或角色 |
|---|---|---|
| `comment.create`（文档级评论） | TL0（限速） | — |
| `comment.inline.create`（行内评论） | TL1 | editor+ |
| `suggestion.create`（编辑建议） | TL2 | editor+ |
| `doc.edit.collab`（直接协作编辑他人文章） | TL3 | editor+（限作用域） |
| `doc.create`（新建文章，发布仍需审批） | TL0 | — |
| `doc.publish.request`（申请发布） | TL0（自己的文章） | — |
| `doc.publish.direct`（免审发布/更新） | TL4 | editor+（限作用域） |
| `doc.publish.approve`（审批发布） | — | section_mod+（限作用域） |
| `suggestion.review`（审校建议） | TL4（仅自己文章 TL2 即可） | editor+ |
| `comment.moderate` / `doc.lock` | — | section_mod+ |
| `role.grant.section` | — | admin+ |
| `system.config` / `role.grant.global` | — | superadmin |

信任晋升参考阈值：TL1≈累计有效阅读+若干被赞评论；TL2≈≥1 篇过审文章或多条优质评论；TL3≈≥3 条被接受建议；TL4=算法达标 + 板块管理员人工确认（高危能力必须有人背书）。

### 4.3 统一判定伪代码

```ts
function can(user: User, cap: Capability, ctx: { sectionId?: ID; doc?: Doc }): boolean {
  if (user.status !== 'active') return false;

  // 0) 负向覆盖最优先：禁言/板块降权一票否决
  if (restrictionDenies(user, cap, ctx.sectionId)) return false;

  // 1) 角色线：作用域为 NULL（全站）或覆盖目标板块的角色
  for (const g of user.roleGrants)
    if (g.sectionId == null || g.sectionId === ctx.sectionId)
      if (ROLE_CAPS[g.role].has(cap)) return true;

  // 2) 所有权特例：作者对自己的草稿天然拥有编辑/提审/撤回能力
  if (ctx.doc?.ownerId === user.id && OWNER_CAPS.has(cap)) return true;

  // 3) 信任线：等级单调包含（TLn 拥有 TLn-1 全部能力）
  if (ctx.doc?.locked && WRITE_CAPS.has(cap)) return false;  // 锁定文档只认角色线
  return TRUST_CAPS[user.trustLevel].has(cap);
}
```

实现要点：`can()` 是 `packages/domain` 中唯一鉴权入口，服务端动作、REST、worker 全部经它；每次拒绝/授予高危能力写 `audit_log`（按月分区的 append-only 表）。

---

## 5. 审批与审校工作流（状态机）

### 5.1 文章发布 = 「移动 published ref」的请求

git 思维下审批对象极其干净：审的不是「文章」，而是**「请求将 `published` ref 指向修订 X」**。首发与已发布文章的更新是同一台状态机。

```sql
CREATE TABLE publish_requests (
  id uuid PRIMARY KEY, document_id uuid NOT NULL,
  revision_id uuid NOT NULL,            -- 申请发布的精确修订
  requester_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  reviewer_id uuid, decided_at timestamptz, review_note text
);
```

```
                 提交申请
  draft ────────────────────▶ pending ──认领──▶ in_review
    ▲                                              │
    │ 作者继续修改后重新提审                          ├─ approve ─▶ approved ──(系统移 ref)──▶ published
    └────────── changes_requested ◀────────────────┤
                                                   └─ reject ──▶ rejected（附理由，可改后重提）
  published 后续：再次提审走同一循环（审批页展示 vs 当前 published 的块级 diff，审「增量」而非重读全文）
  管理动作：published ─ unpublish ─▶ unlisted / archived；任何时刻可将 ref 回滚到历史修订（= git revert，本身也是一次 commit）
```

TL4 / editor 走 `doc.publish.direct` 短路该状态机，但 ref 移动照写审计日志。

### 5.2 编辑建议审校

```
            open ──板块管理员/作者认领──▶ under_review
             │                              │
 作者 withdraw│            ┌─ changes_requested ─▶（作者向分支追加修订）─▶ 回到 under_review
             ▼            │
         withdrawn        ├─ accept ─▶ merging ──无冲突──▶ accepted（产出 merge commit）
                          │              └─同块冲突─▶ conflicted（审校人逐块裁决界面）─▶ accepted
                          ├─ reject ─▶ rejected（必须附理由，作者可见）
                          └─ 主线大幅前移且自动变基失败 ─▶ superseded（提示基于新版重新提出）
```

裁决权归属：文章作者对自己文章的建议有审校权（TL2 即可）；板块管理员/编辑可代为裁决（防作者失联，open 超 14 天自动进入板块审校队列）。每次状态迁移写 `review_events` 表，审校全程可追溯。

---

## 6. 编辑器与协作方案

### 6.1 编辑器：Tiptap 3 + 自定义严格 schema

- 内容格式：**ProseMirror JSON**，schema 定义在 `packages/kernel/schema`（编辑器、渲染器、合并算法共用这一份，版本号写入每个 revision）。
- 节点集刻意收敛（块 = 顶层节点）：`heading(2–4) / paragraph / blockquote / bullet_list / ordered_list / code_block / figure(image+caption) / table / callout / divider / math_block`；marks：`bold / italic / code / link / strikethrough / highlight`。**不做自由嵌套**——schema 越紧，diff/合并/渲染越可靠。
- 块身份落地：每个顶层节点带 `attrs.blockId`（UUID），由编辑器插件在节点创建时注入、分裂/合并段落时按「保留原文多数方」规则继承，提交时服务端校验唯一性。
- 建议模式：低权限用户打开的是「suggestion 编辑器」——同一个 Tiptap 实例，提交时不动 `draft` ref 而是创建 `suggestion/<id>` 分支；行内评论由 ProseMirror Decoration 插件渲染侧栏对齐气泡。

### 6.2 内容 JSON 的规范化与哈希

`canon` 模块定义规范序列化：键按字典序、剔除空 attrs、文本 NFC 归一化，然后 sha256 → blob hash。这保证「内容相同 ⇔ 哈希相同」，去重与 manifest_hash 比对才可信。

### 6.3 OT vs CRDT：分层结论

- **持久层（永远）：提交制（git 模型），不是 OT 也不是 CRDT。** 审计、回滚、审批、建议合并都要求「离散的、有作者有消息的修订」，CRDT 的连续更新流无法直接充当法定历史。
- **实时层（M4 引入）：CRDT（Yjs），明确不选 OT。** 理由：① ProseMirror 官方 collab 模块本质是中心化 rebase，多人高频编辑下体验有限，而完整 OT 的正确实现成本（中心服务器对每 op 转换 + 不可变 op 序）对 1–3 人团队是深渊；② y-prosemirror + Hocuspocus 是经千锤百炼的现成生产组合，离线容忍与断线重连免费获得；③ CRDT 的收敛性不依赖我们写对变换函数。
- **两层缝合协议（防止双真相源漂移）**：实时会话以 `draft` ref 的修订为起点物化 Y.Doc；会话期间 Yjs 是临时真相；每 N 分钟/每次显式保存/最后一人离开时，将 Y.Doc 快照规范化为一次 `kind='collab_checkpoint'` 的 commit 落回 PG；**Yjs 二进制仅作热缓存，可随时丢弃重建，法定历史只有 revisions**。

### 6.4 演进路径

M1 单人编辑（防线 1+3）→ M2 行内评论插件 → M3 建议模式 + 合并界面（防线 2 全量启用）→ M4 Hocuspocus 网关上线，同文档协作会话切换到 Yjs，非会话路径维持原状。每一步都不推翻前一步的数据模型。

---

## 7. 阅读端体验

- **渲染**：读端不加载编辑器。`packages/renderer` 把 ProseMirror JSON 直接渲染为 RSC/HTML，阅读页接近零客户端 JS（目录高亮、行内评论查看为孤岛组件懒加载）。每个块输出 `<section id="b-{blockId}">`，搜索结果与行内评论可深链到块。
- **缓存**：发布页走 Next ISR + 按 tag 失效（移动 `published` ref 时 revalidate）；Caddy 层对匿名流量再加一层短 TTL 缓存。修订历史/diff 页按需渲染 + 强缓存（内容寻址 ⇒ URL 天然不可变，`Cache-Control: immutable`）。
- **中文排版**（借鉴 heti 的实践，做成 `ui` 包里的 `.prose-zh` 样式层）：正文栏宽约 38em；`line-height: 1.9`；`line-break: strict; text-autospace: normal`（中西文间距交给新 CSS 属性，旧浏览器由 renderer 在构建期插入兼容空隙）；标点悬挂与避头尾；字体栈 `system-ui` 优先 + 思源宋体标题子集化（cn-font-split 切片，仅按需加载）；代码块中文注释等宽对齐。
- **SEO**：语义化 HTML + `Article` JSON-LD（含作者、修订时间——修订模型让 `dateModified` 天然精确）；规范 URL `/s/{section}/{slug}`；sitemap 与 RSS 由 worker 生成；OG 图用 satori 按文章标题生成；面包屑结构化数据覆盖板块层级。百度收录：主动推送 API 接入 + 服务端渲染保证可抓取。
- **性能预算**：阅读页 LCP < 1.5s（国内单机 + CDN 静态资源）、首屏 HTML < 60KB、无布局抖动（图片宽高入库）。

---

## 8. 中文搜索方案

**初期（M1 起即上线）：Meilisearch 1.38，块粒度索引。**

- 索引单元 = 块（`{docId, blockId, sectionPath, title, headingPath, text, trustScore, publishedAt}`），命中直接深链 `#b-{blockId}`——「搜到的是段落，不是文章」，对长篇经验文是体验级差异；另建一个轻量文档级索引供标题联想。
- 中文处理：Meilisearch 内置 charabia（jieba 词典）分词，前缀搜索 + 错字容忍对拼音输入场景友好；自定义同义词表（「高考/普通高等学校招生考试」「保研/推免」等求学领域词）作为运营资产持续维护。
- 同步：PG 内 `search_outbox` 表（与业务同事务写入）→ worker 消费推送 Meilisearch。**索引可全量重建**（PG 是唯一真相源），Meilisearch 挂了只降级不丢数据。
- 显式不选：PG FTS + pg_jieba（扩展维护状态差、排序质量低、托管 PG 装不了扩展，违背「不排斥托管平台」）；Elasticsearch（运维重量不匹配团队）。

**远期（M5+）**：Meilisearch 原生 hybrid search 接入向量（bge-m3 类中文 embedding，worker 离线计算入库），实现「我数学基础差怎么准备考研」这类语义问句检索；积累问答对后可再叠 RAG 问答入口。届时仅是索引字段扩展，架构不变。

---

## 9. 演进路线图

| 里程碑 | 周期(估) | 交付物 | 验收红线 |
|---|---|---|---|
| **M0 内核与骨架** | 6 周 | `kernel` 包全量（canon/revision/merge/anchor）+ db schema + 合并矩阵单测；Next 骨架、Better Auth、Docker Compose 一键起 | 内核合并矩阵 100% 单测通过；**这是全项目最高优先级代码** |
| **M1 可发布的博客** | 6 周 | 单人编辑器（块身份注入）、working copy、commit/历史/任意修订查看与回滚、发布审批状态机、阅读端 + 中文排版 + SEO、Meilisearch 块级搜索、文档级评论 | 一篇文章从创建→审批→发布→改版→diff 查看→回滚全链路可演示 |
| **M2 社区底座** | 5 周 | 行内评论 + 锚点重映射、信任等级事件与结算、双线 `can()` 全面接管、通知（站内+邮件）、审计日志、管理后台 | 锚点在剧烈编辑后 remap/orphan 行为符合预期 |
| **M3 建议与审校（产品灵魂）** | 7 周 | 建议分支、补丁 diff 展示、三方合并 + diff3 辅助、冲突裁决 UI、审校队列与状态机、信任线解锁联动 | 「主线前移后接受建议」的自动变基与冲突路径双双可演示 |
| **M4 实时协作** | 6 周 | `apps/collab`（Hocuspocus 3 + Yjs）、checkpoint 缝合协议、在场光标、协作会话与建议流并存 | 断网重连不丢字；checkpoint 修订与 Y.Doc 始终可互相重建 |
| **M5 规模化与深耕** | 持续 | 语义搜索、板块运营工具、贡献者声望页、数据导出（公益项目承诺：全站内容可 dump）、性能与备份演练 | RTO < 1h，RPO < 5min（WAL 归档） |

排期原则：M0/M3 不可压缩；UI 可以糙，内核不能糙。

---

## 10. 主要风险与取舍声明

1. **最大工程风险：合并与冲突 UI（M3）。** 算法不难，难在普通用户能看懂的冲突界面。缓解：块级粒度把冲突概率压到很低（实测 wiki 类编辑绝大多数动不同段落）；冲突 UI 限定为「逐块二选一或手改」，绝不做行级三方合并界面。
2. **双真相源漂移（M4）。** Yjs 热层与提交制冷层若缝合不严会产生「历史里没有的内容」。缓解：checkpoint 协议写入内核测试；Yjs 数据定位为可丢弃缓存，灾难恢复路径只认 revisions。
3. **修订存储无限增长。** 接受这是 wiki 引擎的本质成本。缓解：blob 内容寻址去重 + manifest TOAST 压缩 + 远期冷分区归档；明确**永不**做「删除历史」功能，只做归档。
4. **审核人力是公益项目的真瓶颈，不是技术。** 缓解：信任等级分流（高信任免审/简化审）、审校队列工具化、敏感词 worker 预检前置。技术能做的是把每次人工审核的成本降到「看一个块级 diff」。
5. **依赖成熟度**：Drizzle 1.0 处于 rc（锁版本 + 仓储层隔离，最坏情况换 ORM 不伤内核）；Tiptap 3 商业化倾向加重（我们只用 MIT 开源核心 + 自研建议/评论插件，不依赖其付费云）。
6. **显式取舍**：不做微服务、不做多数据库、不做插件系统、初期不做移动端 App、不支持任意嵌套块（schema 收紧换正确性）。每一项都是为了让 1–3 人团队把弹药集中在协作内核上。
7. **合规与运营风险声明**：中文 UGC 平台的内容合规（备案、实名、未成年人保护）不在本架构文档解决范围，但审批前置发布的设计天然兼容「先审后发」监管要求，为此预留了空间而非事后补救。

---

### 附：关键版本核验来源（2026-06）

- Next.js 16.2 LTS：[nextjs.org/blog](https://nextjs.org/blog) / [endoflife.date/nextjs](https://endoflife.date/nextjs)
- Tiptap 3.26 与 2026 路线：[tiptap.dev/blog/release-notes](https://tiptap.dev/blog/release-notes) / [npm @tiptap/core](https://www.npmjs.com/package/@tiptap/core)
- Meilisearch 1.38：[github.com/meilisearch/meilisearch/releases](https://github.com/meilisearch/meilisearch/releases)
- Drizzle ORM 1.0-rc：[orm.drizzle.team/docs/latest-releases](https://orm.drizzle.team/docs/latest-releases)
- PostgreSQL 18.4：[postgresql.org 发布公告](https://www.postgresql.org/about/news/postgresql-184-1710-1614-1518-and-1423-released-3297/)