# 求学生涯协作博客系统 · 架构提案

> 定位声明：本系统首先是一个 **UGC 社区治理系统**，其次才是博客/wiki。所有技术决策围绕四个治理第一公民展开：**双线权限、信任等级晋升、审批/审校队列、审计追溯**。治理模型大量借鉴 Discourse 信任等级（TL0–TL4）、MediaWiki 巡查/保护/回退（patrol / protection / rollback）、Stack Overflow review queue（租约式认领、理由码、翻案统计）的成熟实践，并将其落地为表结构与统一鉴权层。

---

## 1. 技术栈选型（2026-06 最新稳定版）

| 层 | 选型 | 版本 | 为何胜出 |
|---|---|---|---|
| 运行时 | Node.js | 24 LTS | 与全 TS 技术栈统一；24 为当前 Active LTS，原生 TS strip、性能足够，无需引入第二语言。 |
| 语言 | TypeScript | 5.9 | 领域模型（capability、状态机、补丁 op）全部用可判别联合类型表达，编译期挡掉一类治理逻辑 bug。 |
| 全栈框架 | Next.js（App Router + RSC） | 16（16.2 LTS） | 阅读端 SEO 要求服务端渲染是硬约束；RSC 让「阅读端零编辑器 JS」可行。胜过 SvelteKit/Nuxt 之处在于 ProseMirror/Tiptap 的 React 生态最厚；胜过「SPA + NestJS 分离」之处在于 1–3 人团队只养一个部署单元。自托管走 `output: 'standalone'`，不绑 Vercel。 |
| 内部 API | tRPC | 11 | 单仓单团队下端到端类型安全的成本最低；公共只读 REST（开放数据）后置到 M4 再加。 |
| 数据库 | PostgreSQL | 18（18.4） | 题目指定；18 的新 I/O 子系统对读密集的修订/历史查询正合适。**Postgres 是唯一真理源**，搜索/缓存全部可从它重建。 |
| ORM/迁移 | Drizzle ORM + drizzle-kit | 0.45 稳定线（v1.0 RC 已在 beta，GA 后升级） | SQL-first：修订模型大量用 CTE、窗口函数、partial index，Drizzle 不隐藏 SQL；胜过 Prisma 的点在于迁移文件即纯 SQL，审计友好、无引擎黑盒。 |
| 认证 | Better Auth | 1.6 | 自托管、全功能（邮箱验证、OAuth、2FA、组织/会话管理）、Drizzle 适配器官方支持；胜过 Auth.js（维护动能弱）与 Clerk（SaaS，违背公益自托管）。 |
| 任务队列 | pg-boss | 10 | 队列落在 Postgres，M0–M2 **不引入 Redis**，把运维面压到最小；实时协作上线时再加 Valkey（仅做 presence/限流）。 |
| 编辑器 | Tiptap（ProseMirror） | 3（2025-07 起稳定） | block JSON 模型、SSR 渲染、扩展生态、Yjs 协作路径四项全占；胜过 Lexical（协作与中文 IME 生态弱）、Slate（维护风险）。 |
| 实时协作（远期） | Yjs + Hocuspocus | Yjs 13 / Hocuspocus 3 | ProseMirror 官方协作路线，自托管单容器。 |
| 搜索 | Meilisearch | 1.41 | 单二进制容器、charabia 内置 jieba 中文分词、开箱即用的高亮与过滤；胜过 PG zhparser/PGroonga（需编译扩展、运维知识冷门）、胜过 OpenSearch（对 1–3 人团队过重）。 |
| 样式/UI | Tailwind CSS 4 + shadcn/ui | 4.x | 后台治理界面（队列、对比视图）组件量大，shadcn 可改源码、无锁定。 |
| 校验 | Zod | 4 | tRPC/表单/队列消息三处共用一套 schema。 |
| 对象存储 | S3 兼容（自托管 MinIO / 托管 R2） | — | 图片附件走预签名直传。 |
| 部署 | Docker Compose（app / worker / postgres / meilisearch / caddy） | — | Caddy 自动 HTTPS；整套可在一台 4C8G VPS 起步。 |
| 可观测 | OpenTelemetry + Sentry 自托管（GlitchTip） | — | 审计日志在业务库内（见 §3），技术日志走 OTel。 |

版本依据：[Next.js 16](https://nextjs.org/blog/next-16)（[16.2 LTS](https://eosl.date/eol/product/nextjs/)）、[Tiptap 3.0 stable](https://tiptap.dev/blog/release-notes/tiptap-3-0-is-stable)、[PostgreSQL 18.4](https://www.postgresql.org/about/news/postgresql-184-1710-1614-1518-and-1423-released-3297/)、[Meilisearch releases](https://github.com/meilisearch/meilisearch/releases) 与 [中文分词改进](https://www.meilisearch.com/blog/March-2026-updates)、[Drizzle v1 路线](https://orm.drizzle.team/roadmap)、[Better Auth 1.6](https://better-auth.com/blog/1-6)。

**架构形态结论：模块化单体（modular monolith）**。一个 Next.js 应用 + 一个 worker 进程，领域逻辑全部下沉到 packages，按「内容 / 治理 / 鉴权 / 搜索」划界。拆分点（若未来需要）天然是 worker、搜索、协作网关三处——但 M 系列里程碑内不拆。

---

## 2. Monorepo 工程结构

pnpm workspace + Turborepo 2。

```
harublog/
├─ apps/
│  ├─ web/                  # Next.js 16：阅读端、编辑端、治理后台、tRPC 路由
│  │  ├─ app/(reader)/      # 阅读端路由组（RSC、零编辑器 JS）
│  │  ├─ app/(studio)/      # 写作/建议/协作编辑
│  │  ├─ app/(govern)/      # 队列、审计、用户治理后台
│  │  └─ server/            # tRPC routers（薄壳，调用 packages/core）
│  └─ worker/               # pg-boss 消费者：搜索索引、信任分计算、锚点重定位、
│                           #   通知扇出、TL 晋升/回落巡检、定时任务
├─ packages/
│  ├─ db/                   # Drizzle schema、迁移、种子数据；唯一可写 SQL 的包
│  ├─ core/                 # 领域层（纯函数 + 仓储接口）：
│  │  ├─ content/           #   文档/修订/块的提交、合并、回退
│  │  ├─ suggestion/        #   补丁生成、三方冲突检测、变基
│  │  ├─ governance/        #   信任引擎、队列、举报、制裁、状态机
│  │  └─ notification/      #   通知规则
│  ├─ authz/                # 双线鉴权引擎：capability 清单、grant 编译、can() 判定器
│  │                        #   （同构：服务端强制 + 前端 UI gating 复用同一份）
│  ├─ editor/               # Tiptap schema/扩展（blockId、建议模式、行内评论 decoration）
│  │  └─ render/            # ProseMirror JSON → HTML 的纯渲染器（阅读端用，无编辑器依赖）
│  ├─ search/               # Meilisearch 索引定义、同步消费者、查询构造
│  ├─ ui/                   # 共享组件（diff 对照视图、队列卡片、TL 徽章等）
│  └─ config/               # tsconfig / eslint / 常量（TL 阈值等可配置治理参数）
├─ docker/                  # compose、Caddyfile、备份脚本
└─ docs/                    # ADR（架构决策记录，治理规则变更也走 ADR）
```

**铁律**：`apps/*` 不直接写 SQL，必须经 `core` 的用例函数；`core` 的每个会改变治理状态的用例必须返回「审计事件」，由调用方在同一事务落 `audit_log`。这条边界是未来拆分与审计完备性的保障。

---

## 3. 核心数据模型：块级内容 + 全历史修订 + 建议补丁

### 3.1 总体结论：采用「类 git 的 commit/tree/blob」三层不可变模型，外加 git 没有的「稳定块身份」

| git 概念 | 本系统 | 表 |
|---|---|---|
| blob | 块修订（块的一个不可变内容版本） | `block_revisions` |
| tree | 修订的有序块清单 | `doc_revision_blocks` |
| commit | 文档修订 | `doc_revisions` |
| branch HEAD | `documents.head_revision_id`（草稿线） | `documents` |
| release tag | `documents.published_revision_id`（审批指针） | `documents` |
| merge commit | 建议合入产生的修订（记 `merged_suggestion_id` 为第二亲缘） | `doc_revisions` |

与 git 的关键差异：**块有稳定身份 `block_id`**（git 的 blob 是匿名内容寻址）。稳定块 ID 是三件事的基石：行内评论锚定、建议补丁的目标定位、块级三方合并的冲突判定。

### 3.2 表结构

```sql
-- 板块（治理作用域单位）
CREATE TABLE sections (
  id          uuid PRIMARY KEY,
  slug        text UNIQUE NOT NULL,        -- 'junior-high' / 'senior-high' / 'college' / ...
  name        text NOT NULL,
  parent_id   uuid REFERENCES sections(id),-- 支持二级板块（大学 > 考研/保研/留学）
  position    int NOT NULL DEFAULT 0
);

CREATE TABLE documents (
  id                     uuid PRIMARY KEY,
  section_id             uuid NOT NULL REFERENCES sections(id),
  slug                   text UNIQUE NOT NULL,
  title                  text NOT NULL,
  summary                text,
  status                 doc_status NOT NULL DEFAULT 'draft',
    -- 'draft'|'submitted'|'published'|'archived'|'deleted'
  head_revision_id       uuid,             -- 工作头（草稿线，类 branch HEAD）
  published_revision_id  uuid,             -- 当前对外发布的修订（审批指针，类 tag）
  protection             protection_level NOT NULL DEFAULT 'semi',
    -- 'open'    : TL2+ 可直接编辑（事后巡查）
    -- 'semi'    : TL3+ 可直接编辑（事后巡查）—— 默认
    -- 'editors' : 仅 editor 角色 / TL4
    -- 'locked'  : 仅板块管理员及以上（MediaWiki 页面保护同款语义）
  owner_id               uuid NOT NULL REFERENCES users(id),
  version                int NOT NULL DEFAULT 0,   -- 乐观锁计数
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 块身份：一旦创建永不删除（删除只是从后续修订的 tree 中消失）
CREATE TABLE blocks (
  id                  uuid PRIMARY KEY,
  document_id         uuid NOT NULL REFERENCES documents(id),
  created_in_revision uuid NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- blob：块修订，不可变（无 UPDATE 权限，触发器拒绝）
CREATE TABLE block_revisions (
  id            uuid PRIMARY KEY,
  block_id      uuid NOT NULL REFERENCES blocks(id),
  parent_id     uuid REFERENCES block_revisions(id),  -- 块内修订链 ⇒ 块级历史
  content       jsonb NOT NULL,        -- Tiptap 节点 JSON（一个顶层块）
  content_hash  bytea NOT NULL,        -- sha256(canonical_json)，快速等价比较 + 去重
  text_plain    text NOT NULL,         -- 抽取纯文本：diff、搜索索引、锚点重定位共用
  author_id     uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (block_id, content_hash)      -- 同块同内容（撤销又恢复）不重复存储
);

-- commit：文档修订，不可变
CREATE TABLE doc_revisions (
  id                    uuid PRIMARY KEY,
  document_id           uuid NOT NULL REFERENCES documents(id),
  parent_id             uuid REFERENCES doc_revisions(id),
  kind                  rev_kind NOT NULL,
    -- 'edit' | 'suggestion_merge' | 'rollback' | 'restore' | 'import'
  merged_suggestion_id  uuid,          -- kind='suggestion_merge' 时指向建议（第二亲缘）
  message               text,          -- 修订说明（提交者填写，巡查时展示）
  author_id             uuid NOT NULL,
  char_delta            int NOT NULL DEFAULT 0,  -- 冗余统计：喂信任分与巡查优先级
  blocks_changed        int NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON doc_revisions (document_id, created_at DESC);

-- tree：修订 → 有序块清单，不可变
CREATE TABLE doc_revision_blocks (
  doc_revision_id   uuid NOT NULL REFERENCES doc_revisions(id),
  position          int  NOT NULL,
  block_id          uuid NOT NULL REFERENCES blocks(id),
  block_revision_id uuid NOT NULL REFERENCES block_revisions(id),
  PRIMARY KEY (doc_revision_id, position)
);
CREATE INDEX ON doc_revision_blocks (block_id, doc_revision_id); -- 「该块出现在哪些修订」
```

### 3.3 文档修订与块修订的关系（结构共享）

- 提交一次编辑时：**只有内容变化的块**创建新的 `block_revisions` 行；未变块在新修订的 tree 中**直接复用旧 `block_revision_id`**。这就是 git 的结构共享——一篇 200 块的文章改一段，只新增 1 个 blob + 200 行 tree 行（tree 行极窄）。
- 块级历史 = 沿 `block_revisions.parent_id` 链回溯；文档级历史 = 沿 `doc_revisions.parent_id` 链回溯。两条历史天然一致，因为 tree 是连接件。
- 「谁写了这一段」（MediaWiki blame）：对任一块，取其当前 `block_revision` 的 `author_id` 即段落署名，O(1)。
- 取舍声明：每修订全量 tree 行是空间换简单（一篇千修订 × 200 块 ≈ 20 万窄行，完全可控）。若未来超预期，可在不破坏不可变语义下迁移为「区间复用 + 变更集」delta 编码，预留 `kind='import'` 做迁移重放。

### 3.4 编辑建议（suggestion）= 针对某个 base 修订的块级补丁

```sql
CREATE TABLE suggestions (
  id                 uuid PRIMARY KEY,
  document_id        uuid NOT NULL REFERENCES documents(id),
  author_id          uuid NOT NULL,
  base_revision_id   uuid NOT NULL REFERENCES doc_revisions(id),  -- 补丁基底
  status             suggestion_status NOT NULL DEFAULT 'open',
    -- 'open'|'under_review'|'changes_requested'|'merged'|'rejected'|'outdated'|'withdrawn'
  comment            text,                 -- 建议说明（必填，治理要求给理由）
  merged_revision_id uuid,                 -- 合入后指向产生的 merge 修订
  decided_by         uuid,
  decided_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE suggestion_ops (
  id                        uuid PRIMARY KEY,
  suggestion_id             uuid NOT NULL REFERENCES suggestions(id),
  seq                       int NOT NULL,          -- 应用顺序
  op                        sugg_op NOT NULL,      -- 'replace'|'insert_after'|'delete'|'move'
  target_block_id           uuid,                  -- replace/delete/move 的目标块
  target_block_revision_id  uuid,                  -- 提出建议时目标块的修订 ⇒ 三方合并的 base
  anchor_block_id           uuid,                  -- insert_after/move 的位置锚（null=文首）
  new_content               jsonb,                 -- replace/insert 的新块内容
  UNIQUE (suggestion_id, seq)
);
```

补丁生成：建议者在「建议模式」编辑器里基于 `base_revision` 自由编辑，保存时由 `core/suggestion` 对比 base tree 与编辑结果（按 `block_id` 对齐 + `content_hash` 比较），自动生成最小 op 序列。**用户永远不手写补丁。**

**合入与冲突检测（块级三方合并）**，在单事务内：

1. `SELECT ... FOR UPDATE` 锁 `documents` 行，取当前 `head_revision_id`。
2. 对每个 op 做三方判定：目标块在 **head** 中的 `block_revision_id` 是否等于 op 记录的 `target_block_revision_id`（或 `content_hash` 相等）？
   - 相等 ⇒ 干净应用（base 与 head 间无人动过这个块）。
   - 不等 / 块已被删除 ⇒ **冲突**，建议置为 `outdated`，事务回滚；建议者获得三栏对照（base / head / 建议）做变基。
   - `insert_after` 仅当锚块被删除时降级：挂到最近的存活前驱之后，不算冲突。
3. 全部干净 ⇒ 生成 `doc_revisions(kind='suggestion_merge', parent_id=head, merged_suggestion_id=...)` + 新 tree，CAS 更新 head。

**结论：冲突原子单位是「块」（段落级）**。这是刻意取舍：比字符级 OT/CRDT 简单一个数量级，且对 wiki 式中文长文（段落为修改单元）完全够用；段内并发精修的需求由远期 Yjs 草稿协作承接（§6）。

### 3.5 直接编辑的并发控制（乐观 CAS）

```sql
UPDATE documents
   SET head_revision_id = :new_rev, version = version + 1, updated_at = now()
 WHERE id = :doc_id AND head_revision_id = :expected_parent;
-- 影响 0 行 ⇒ 409：前端自动尝试块级变基（同 3.4 算法）；仍冲突则人工对照
```

提交期间用 `pg_advisory_xact_lock(hashtext(doc_id))` 串行化构建过程。辅以**编辑 presence 软提示**（「××正在编辑本文」，30 秒心跳），把 MediaWiki 式编辑冲突在 UX 层就消解大半。

### 3.6 评论与行内评论（锚定模型）

```sql
CREATE TABLE comment_threads (
  id            uuid PRIMARY KEY,
  document_id   uuid NOT NULL REFERENCES documents(id),
  kind          thread_kind NOT NULL,   -- 'doc' | 'inline' | 'suggestion'
  suggestion_id uuid,                    -- kind='suggestion'：审校讨论线程
  block_id      uuid,                    -- kind='inline'：锚定块（稳定 ID，块移动不丢锚）
  anchor        jsonb,                   -- {from, to, quote, prefix, suffix} 相对块内文本
  anchor_status anchor_status NOT NULL DEFAULT 'attached',  -- 'attached'|'relocated'|'orphaned'
  status        thread_status NOT NULL DEFAULT 'open',      -- 'open'|'resolved'|'hidden'|'deleted'
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE comments (
  id         uuid PRIMARY KEY,
  thread_id  uuid NOT NULL REFERENCES comment_threads(id),
  author_id  uuid NOT NULL,
  content    jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at  timestamptz,
  hidden_by  uuid, hidden_reason text    -- 治理隐藏保留原文（审计可见）
);
```

重锚定策略（W3C Web Annotation / Hypothesis 的 fuzzy anchoring 思路）：块产生新修订时，worker 用 `quote + prefix/suffix` 在新 `text_plain` 上模糊重定位；因为锚是**块内**而非全文偏移，重定位范围小、成功率高；失败则 `orphaned`，UI 折叠展示并保留原引文。

---

## 4. 双线权限模型：统一为「capability + 作用域 + 义务」

### 4.1 数据模型

```sql
-- 角色线（自上而下，指派制，带作用域与到期）
CREATE TABLE role_assignments (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id),
  role        role_t NOT NULL,    -- 'superadmin'|'admin'|'section_mod'|'editor'
  scope_type  scope_t NOT NULL,   -- 'global'|'section'（editor/section_mod 必须 section 域）
  scope_id    uuid,               -- section_id
  granted_by  uuid NOT NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz,        -- 任期制：到期自动失效，续任留痕
  revoked_at  timestamptz, revoked_by uuid, revoke_reason text
);

-- 信任线（自下而上，系统计算 + 管理员可锁定，Discourse 同款）
CREATE TABLE user_trust (
  user_id      uuid PRIMARY KEY,
  level        int NOT NULL DEFAULT 0,      -- TL0..TL4
  level_locked boolean NOT NULL DEFAULT false,
  manual_level int,                          -- 锁定时生效（惩罚性降级或荣誉性提级）
  promoted_at  timestamptz
);
CREATE TABLE trust_stats (  -- 滚动统计，worker 维护
  user_id uuid PRIMARY KEY,
  days_visited int, posts_read int, comments_created int,
  suggestions_merged int, suggestions_rejected int,
  edits_patrolled_ok int, edits_reverted int,
  flags_agreed int, flags_disagreed int,
  updated_at timestamptz
);
CREATE TABLE trust_events (  -- 事件流（可重放重算，治理参数调整后全量重评）
  id bigserial PRIMARY KEY, user_id uuid, kind text, payload jsonb,
  source_type text, source_id uuid, created_at timestamptz DEFAULT now()
);

-- 制裁（最高优先级否决）
CREATE TABLE sanctions (
  id uuid PRIMARY KEY, user_id uuid NOT NULL,
  kind sanction_t NOT NULL,  -- 'suspend'|'silence'|'no_suggest'|'no_edit'
  scope_type scope_t NOT NULL DEFAULT 'global', scope_id uuid,
  reason text NOT NULL, issued_by uuid NOT NULL,
  starts_at timestamptz, ends_at timestamptz, revoked_at timestamptz
);
```

### 4.2 信任等级定义（Discourse 改编，针对「贡献质量」而非「活跃度」加权）

| 等级 | 名称 | 晋升条件（参数全部进配置表，可调） | 解锁 |
|---|---|---|---|
| TL0 | 新人 | 注册 | 阅读；评论（限速，**首帖进 first_post 审核队列**）；低权重举报 |
| TL1 | 成员 | 访问 ≥3 天、阅读 ≥20 篇、通过首帖审核 | 评论免审；**行内评论** |
| TL2 | 贡献者 | 访问 ≥15 天、有效评论 ≥10、无近期被处理举报 | **提交编辑建议**；创建文章并提交审批；编辑 `open` 级文档（进巡查队列） |
| TL3 | 资深贡献者 | 滚动 100 天窗口：建议被合入 ≥5、合入/拒绝比 ≥3:1、举报命中率 ≥80%、无制裁 | **直接编辑 `semi` 级文档（事后巡查）**；参与巡查队列与建议初审；高权重举报；**可回落**（窗口不达标降回 TL2） |
| TL4 | 共建者 | **仅手动授予**（板块管理员提名、管理员批准） | 协作编辑 `editors` 级文档；建议终审（非保护文档）；不再回落，仅可被撤销 |

要点（皆为 Discourse 验证过的设计）：TL3 滚动窗口可回落、TL4 只手动、管理员可锁定任何人的 TL、所有 TL 变更写 `trust_events` + `audit_log`。

### 4.3 Capability 清单

```
内容消费   content.read
评论       comment.create  comment.edit_own  comment.hide(治理)
行内评论   inline_comment.create
建议       suggestion.create  suggestion.review  suggestion.merge
文章       doc.create  doc.submit  doc.edit_direct  doc.publish  doc.unpublish
保护/回退  doc.protect  doc.rollback
举报       flag.create  flag.review
队列       queue.first_post  queue.new_document  queue.suggestion  queue.flag  queue.edit_patrol
用户治理   user.suspend  user.trust_adjust  role.grant_section  role.grant_global
系统       section.manage  system.settings
```

**角色专属红线**（信任线永远拿不到）：`doc.publish / doc.unpublish / doc.protect / user.suspend / role.* / system.settings`。晋升给能力，**任命给权力**——这是双线的本质分界。

角色 → capability（带作用域）：

| 角色 | 在作用域内获得 |
|---|---|
| editor（板块域） | `doc.edit_direct`（≤ editors 级）、`suggestion.review/merge`、`queue.new_document`（初审）、`queue.suggestion`、`queue.edit_patrol` |
| section_mod（板块域） | editor 全部 + `doc.publish/unpublish/protect/rollback`、`flag.review`、`comment.hide`、`queue.flag`、TL4 提名 |
| admin（全局） | section_mod 全部（全板块）+ `user.suspend`、`user.trust_adjust`、`role.grant_section`、`section.manage` |
| superadmin（全局） | 一切 + `role.grant_global`、`system.settings`（数量 ≤2，操作全审计） |

### 4.4 统一判定器（packages/authz，纯函数、同构）

核心思想：两条线在编译期都被压成同一种 **Grant**——`{capability, scope, obligations}`；判定器只有一个，且返回的不是布尔而是**裁决**（可附带义务）。「允许但进巡查队列」「允许但限速」就是治理与权限在同一层统一的关键。

```ts
type Decision =
  | { allow: true; via: 'role' | 'trust'; obligations: Obligation[] } // 如 [{type:'enqueue_patrol'}, {type:'rate_limit', key:'comment'}]
  | { allow: false; reason: DenyReason };                             // 给前端可解释的拒因（“需要 TL2”）

function can(actor: Actor, cap: Capability, res?: Resource): Decision {
  // 0. 制裁一票否决（含板块域禁言）
  const s = actor.sanctions.find(s => s.blocks(cap) && s.covers(res));
  if (s) return deny({ kind: 'sanction', until: s.endsAt });

  // 1. 角色线：作用域匹配（global 覆盖一切；section 域须命中资源所属板块）
  for (const ra of actor.roles)
    if (ROLE_GRANTS[ra.role].has(cap) && inScope(ra, res))
      return allow('role', roleObligations(ra.role, cap));   // 角色行为也可有义务（如 publish 必填理由）

  // 2. 信任线：全局授予，但受三重约束
  const tl = actor.trust.locked ? actor.trust.manualLevel! : actor.trust.level;
  if (TRUST_GRANTS[tl].has(cap)
      && !ROLE_ONLY_CAPS.has(cap)                            // 红线能力直接短路
      && meetsProtection(cap, tl, res)                       // doc.edit_direct: tl ≥ protectionFloor(res)
      && ownershipOk(cap, actor, res))                       // 如 doc.submit 仅限 owner
    return allow('trust', trustObligations(tl, cap));        // TL2 编辑 ⇒ enqueue_patrol；TL0 评论 ⇒ pre_moderation
  
  return deny({ kind: 'insufficient', needs: minRequirement(cap, res) });
}
```

执行纪律：服务端每个 tRPC 用例入口强制 `can()`；前端用同一包做按钮显隐与**拒因解释**（「再获得 3 次建议合入即可解锁直接编辑」——把鉴权拒绝变成晋升引导，这是社区增长机制的一部分）；裁决按采样写入审计上下文。

---

## 5. 审批与审校工作流

### 5.1 统一队列基建（Stack Overflow review queue 范式）

```sql
CREATE TABLE review_items (
  id           uuid PRIMARY KEY,
  queue        queue_t NOT NULL,  -- 'first_post'|'new_document'|'suggestion'|'flag'|'edit_patrol'
  subject_type text NOT NULL, subject_id uuid NOT NULL,
  section_id   uuid,              -- 路由：板块管理员/编辑只看自己作用域
  priority     int NOT NULL DEFAULT 0,   -- char_delta 大/被举报/新人 ⇒ 提权
  status       review_status NOT NULL DEFAULT 'pending',
    -- 'pending'|'claimed'|'done'|'expired'
  claimed_by   uuid, claim_expires_at timestamptz,  -- 15 分钟租约，过期自动回池（防认领即失踪）
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (queue, subject_type, subject_id)
);
CREATE TABLE review_actions (   -- 不可变；翻案率/审稿一致性统计的数据源
  id uuid PRIMARY KEY, review_item_id uuid NOT NULL,
  reviewer_id uuid NOT NULL,
  action text NOT NULL,          -- approve|reject|request_changes|escalate|revert|dismiss
  reason_code text,              -- 结构化理由码（拒稿必填，供申诉与统计）
  note text, created_at timestamptz DEFAULT now()
);
```

规则：审稿人不得审自己的提交（DB 约束 + 鉴权层双保险）；`escalate` 上交管理员；所有 action 落审计。

### 5.2 新文章审批状态机

```
draft ──submit──▶ submitted ──claim──▶ in_review
                                        │ approve ──▶ published（published_revision_id := 被审的那个修订）
                                        │ request_changes ──▶ draft（审稿意见以 suggestion 线程留存，循环再提）
                                        │ reject(理由码必填) ──▶ rejected ──appeal──▶ 升级 admin 复核
published ──unpublish(section_mod, 理由必填)──▶ archived
```

关键治理性质：**审批对象是具体 `revision_id` 而非「文章」**。批准即移动发布指针；作者后续编辑走草稿线，不影响线上，再次上线按保护级走巡查或再审批。线上每个字都能指认到「哪个修订、谁批的、何时批的」。

发布后的修改策略（事前审批 → 事后巡查的梯度，平衡质量与摩擦）：

| 修改者 | 路径 |
|---|---|
| TL2（open 文档）/ TL3（semi 文档） | 直接生效，进 `edit_patrol` 巡查队列（MediaWiki 巡查制） |
| TL2 对 semi 文档 | 只能走 suggestion |
| 巡查发现劣化 | `doc.rollback` 一键回退 = 创建 `kind='rollback'` 新修订指回旧 tree，**历史不删** |

### 5.3 编辑建议审校状态机

```
open ──(reviewer claim)──▶ under_review
   under_review ── approve+merge ──▶ merged（事务内：冲突检测→merge 修订→CAS head）
   under_review ── request_changes ──▶ changes_requested ──作者更新 ops──▶ open
   under_review ── reject(理由码) ──▶ rejected
open ──(head 移动且检测到块冲突, worker 自动)──▶ outdated ──作者变基──▶ open
open ──作者撤回──▶ withdrawn
```

审校权梯度：TL3 可初审（标注意见），合入权在 TL4/editor/section_mod；`editors` 级文档的建议只有角色线能合入。每次 merge/reject 反馈到提议者的 `trust_stats`（合入加分、被拒减分），形成信任飞轮。

### 5.4 举报队列

举报权重随 TL 上升（Discourse flag weight）：高信任用户 N 个举报可自动临时隐藏内容（`hidden` 待复核），低信任举报只进队列。处理结论回写举报者命中率，命中率过低自动降低其举报权重——反滥用闭环。

---

## 6. 编辑器与协作方案

**编辑器：Tiptap 3 自托管扩展集**（不依赖 Tiptap Cloud 付费件，公益自托管原则）。

- **文档 schema**：顶层是块序列（paragraph / heading / blockquote / codeBlock / image / callout / list / table…），每个顶层块经 UniqueID 扩展携带 `attrs.blockId`（即 `blocks.id`）。**存储格式 = 每块一份 ProseMirror JSON**（`block_revisions.content`），不存整篇 HTML——这保证编辑、渲染、diff、搜索四方共享同一真理格式。
- **三种编辑模式，同一编辑器内核**：
  1. **直接编辑**（权限足够者）：保存时按 blockId 对齐 diff，产出新修订（§3.3）。
  2. **建议模式**（TL2+）：UI 与直接编辑几乎一致，但保存产出 `suggestion_ops` 补丁（§3.4）；阅读侧以红绿块对照渲染建议。自研此模式（基于块快照 diff）而非购买 track-changes Pro 扩展——块级粒度让自研成本可控。
  3. **行内评论**：阅读页选区 → 弹出评论框 → 写入 `comment_threads(kind='inline')`；编辑器内用 decoration 展示锚点，不污染文档内容 JSON。
- **中文输入**：ProseMirror 的 IME 组合事件处理是几大框架中最成熟的；上线前以中文长文 + 拼音长句组合输入作为发布门禁测试项。
- **实时协作演进路径（刻意分三阶，避免提前吞下 CRDT 复杂度）**：
  - **A（M0–M2）**：单人编辑 + CAS + presence 软提示（「某某正在编辑」）。
  - **B（M3 前期）**：编辑租约（5 分钟可续，写入 presence 表），把并发冲突压到罕见。
  - **C（M3）**：Yjs + Hocuspocus 3，**仅对草稿态、且仅对 TL4/editor 开放**实时协作；Yjs 文档是「工作台」，定期与显式保存点把 Yjs 状态快照 diff 成不可变 `doc_revision`。**修订层才是真理与审计对象，CRDT 只是输入法**——这条原则保证治理/历史模型在引入实时协作后纹丝不动。

---

## 7. 阅读端体验

- **渲染架构**：`packages/editor/render` 提供 ProseMirror JSON → HTML 的纯函数渲染器，RSC 服务端执行；**阅读页面零编辑器 JS**，仅水合行内评论选区监听一个小岛。每个块输出 `id="blk-{shortid}"` 锚点——行内评论定位、搜索结果深链、外部引用三处共用。
- **缓存**：发布修订不可变 ⇒ 完美缓存对象。ISR + `revalidateTag(doc:{id})`，仅在发布指针移动时失效；列表页 60s 软 TTL。Caddy 层再加 stale-while-revalidate。
- **中文排版**（参考 heti 的实践，做成 `@harublog/ui` 的 typography 层）：
  - 正文 `font-family: "Noto Serif SC", serif` 子集化自托管（cn-font-split 按站内字频子集 + `font-display: swap`），UI 用系统黑体栈；
  - `text-align: justify; text-justify: inter-ideograph; line-height: 1.9`；行宽约 38 个汉字（`max-width: 38em` 等效）；
  - 标点挤压 `text-spacing-trim: space-all`、中西文间距 `text-autospace`（2025+ 浏览器原生支持，旧浏览器优雅降级）；
  - 段首不缩进 + 段间距方案（屏幕阅读结论），`hanging-punctuation` 渐进增强。
- **SEO**：Next Metadata API 全量元信息；JSON-LD `Article` + `BreadcrumbList`（作者、修订时间真实可信——治理体系反而是 E-E-A-T 资产）；增量 sitemap + RSS/Atom；canonical 严格唯一（slug 改名 301）；satori 生成中文 OG 图；语义化 heading 直接来自块结构。
- **性能预算**：文章页 LCP < 1.8s（4G 中端机）、阅读路径 JS < 60KB gzip、CLS≈0（字体度量回退 `size-adjust`）。

---

## 8. 中文搜索方案

**初期结论（M1 上线）：Meilisearch 1.41 单容器，Postgres 经事务性 outbox 单向同步。**

- 两个索引：`documents`（标题、摘要、标签、板块、作者，权重高）与 `blocks`（`text_plain` + `blockId` + 文档元信息）。块级索引让搜索结果**直达段落锚点**（`/{slug}#blk-x`），这是长文站的体验差异点。
- 中文：charabia 内置 jieba 分词，近期版本已修复中英数字混排切分；**领域自定义词典**（「强基计划」「综评」「保研夏令营」等求学黑话）作为运营资产持续维护。
- 同步：领域事件写 `outbox_events` 表（与业务同事务），worker 消费推送 Meilisearch——**索引可随时从 Postgres 全量重建**，Meilisearch 无需备份、无 HA 焦虑。
- 兜底：Postgres `pg_trgm` 提供站内管理后台的精确子串检索（治理排查用），不对用户暴露。

**远期路线**：

1. **混合检索（M4）**：Meilisearch 内置向量存储 + `bge-m3` 中文 embedding（worker 离线计算，块级粒度），关键词 + 语义 hybrid 召回，解决「中考失利怎么调整心态」这类无关键词重叠的查询——对经验类内容价值极大。
2. **仅当**数据量/可用性要求超出单节点（数百万块、多节点 HA）时，迁移 OpenSearch + IK 分词；`packages/search` 的接口抽象保证迁移只动一个包。

---

## 9. 演进路线图

| 里程碑 | 周期(估) | 内容 | 治理交付 |
|---|---|---|---|
| **M0 骨架** | 6 周 | Monorepo、Better Auth、板块/文档/**完整修订模型**（§3 全部表一次到位）、直接编辑（仅作者）、阅读端 RSC 渲染 + 基础排版 | `new_document` 审批队列、`audit_log`（链式哈希）、角色线（admin/section_mod）、CAS 并发控制 |
| **M1 社区基础** | +8 周 | 评论、行内评论（锚定+重定位）、通知（站内+邮件摘要）、Meilisearch 搜索、SEO 全量 | 信任引擎 TL0–TL2、`first_post` 队列、举报+权重、制裁、限速 |
| **M2 协作纵深** | +10 周 | **编辑建议全流程**（补丁生成、三方合并、变基 UI、红绿对照）、块级/文档级历史浏览与 blame | `suggestion` 审校队列、TL3（含回落）、`edit_patrol` 巡查队列、文档保护级、回退 |
| **M3 实时协作** | +10 周 | 编辑租约 → Yjs+Hocuspocus 草稿协作、editor 角色工作台（板块队列总览） | TL4 提名/授予流程、协作编辑权限、治理指标看板（队列时延、翻案率、举报命中率） |
| **M4 增长与开放** | 持续 | Hybrid 语义搜索、专题/合集策展、只读 REST API 与数据导出（CC 协议开放语料）、性能与 SEO 深化 | 治理参数自助调优（阈值配置化已就绪）、年度透明度报告（审计数据产出） |

纪律：修订模型与审计表在 M0 一次成型不返工（它们是地基）；信任阈值等治理参数全部配置化，调参不发版。

---

## 10. 主要风险与取舍声明

1. **块级（段落级）冲突粒度**：大规模重排/拆并段落时建议易 `outdated`。**接受**——以变基 UI 缓解，换来不做字符级 OT 的复杂度节省一个数量级；段内精修协作由 M3 的 Yjs 草稿协作承接。
2. **自研建议模式**而非采购 track-changes 商业扩展：约多 3–4 周开发，换得自托管纯净与补丁模型完全自主（补丁即治理对象，必须自己掌握其语义）。
3. **发布前审批的冷启动摩擦**会抑制贡献。对冲手段已内建：TL 梯度把「事前审批」逐级换成「事后巡查」，且鉴权拒因直接转化为晋升引导文案；阈值全配置化，运营期可松紧。
4. **审稿人力是公益项目最稀缺资源**。整个队列体系（租约、理由码、举报权重、自动隐藏、翻案统计）都是在为「少数志愿者治理多数内容」省人力；M3 看板让瓶颈可见。
5. **每修订全量 tree 行**的存储增长：量级测算可控（§3.3），监控 + 预留 delta 编码迁移路径；不可变语义保证迁移可离线重放。
6. **Drizzle v1 处于 RC**：锁 0.45 稳定线，v1 GA 后按迁移指南升级；schema 全在 `packages/db` 一处，升级面收敛。
7. **Meilisearch 单节点无 HA**：接受。索引非真理源、可全量重建，故障损失仅为「搜索短暂降级」，RTO=重建时间（分钟级）。
8. **Next.js 深度绑定风险**：渲染器、领域层、鉴权层全部在框架无关的 packages 中，`apps/web` 是薄壳；standalone 自托管不依赖 Vercel 专有设施。
9. **中文分词上限**：jieba 词典对新黑话滞后——以运营维护的领域词典缓解，M4 向量混合检索兜底语义召回。
10. **审计与隐私的张力**：审计日志存 IP/UA 哈希而非明文，链式哈希保证不可篡改的同时满足最小化收集；公开透明度报告只出聚合数据。