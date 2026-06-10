# 成熟系统机制设计调研报告

> 调研对象：Discourse 信任等级、MediaWiki/维基百科修订与审核机制、Google Docs 建议模式与 GitHub suggested changes、Notion/ProseMirror 块级文档模型。
> 调研目的：为「求学生涯」多人协作开放博客系统的权限体系、审校工作流、行内锚定与块级修订设计提供参照。

---

## 一、Discourse 信任等级（TL0–TL4）

### 1.1 设计哲学

Discourse 的信任等级是「自下而上」的权限体系：信任通过**可度量的日常行为**（阅读、参与、被认可、无违规）自动积累，系统后台任务定期评估并自动晋升，工作人员（staff）只在最高一级人工介入。它与「自上而下」的 admin/moderator 指派体系并行存在——这正是本项目「双线权限」的原型。

### 1.2 各级条件与能力（默认阈值，全部可配置）

| 等级 | 名称 | 晋升条件（默认值） | 解锁的关键能力 |
|---|---|---|---|
| TL0 | New（新用户） | 注册即得 | 受限参与：不能发私信、不能举报；每帖图片/附件/链接数量受限（如最多 1 图、2 链接）、@提及人数受限；可发主题/回复数量很少 |
| TL1 | Basic（基本用户） | 进入 ≥5 个主题；阅读 ≥30 个帖子；累计阅读 ≥10 分钟 | 解除大部分新手限制：发私信、上传图片/附件、**编辑 wiki 帖**、举报帖子、屏蔽用户 |
| TL2 | Member（成员） | 访问 ≥15 天（不要求连续）；送出 ≥1 个赞、收到 ≥1 个赞；在 ≥3 个不同主题回复；进入 ≥20 个主题；阅读 ≥100 帖；累计阅读 ≥60 分钟 | 邀请他人进入主题、创建群组私信、每日操作上限 ×1.5、忽略用户、自己帖子的可编辑窗口延长到 30 天 |
| TL3 | Regular（活跃用户） | **最近 100 天滑动窗口**内：访问 ≥50% 的天数；在 ≥10 个不同（非私信）主题回复；浏览该期间新建主题的 25%（封顶 500）；阅读该期间新帖的 25%（封顶 2 万）；收到 ≥20 赞且送出 ≥30 赞；垃圾/冒犯举报被采纳 ≤5 次；近 6 个月未被禁言/封禁 | 重新分类与重命名主题；进入 TL3 专属版块；发的链接去掉 nofollow；其举报垃圾帖可**立即隐藏**该帖；多名 TL3 举报新用户可自动禁言之；可把自己的帖子设为 wiki；每日上限 ×2 |
| TL4 | Leader（领袖） | **仅由 staff 手工晋升**（不自动） | 编辑所有人的帖子；置顶/关闭/归档/拆分/合并主题；单人举报即可隐藏帖子；每日上限 ×3 |

### 1.3 自动晋升与降级机制

- **晋升**：后台定时任务计算指标，达标即自动晋升并发送祝贺私信。TL1/TL2 是**一次性达成、永久保留**（棘轮式）。
- **降级**：**只有 TL3 可被自动降级**——它基于 100 天滑动窗口持续重估，指标跌破阈值即降回 TL2；为防「边界抖动」，设有**晋升后 2 周宽限期**，且有可配置的降级容差（leeway）。
- **人工干预**：管理员可手工设定某用户等级，并可**锁定（lock）**等级使其不再被自动重算；被禁言/封禁直接阻断晋升资格。
- 关键取舍：低等级不可逆（保护新人积极性），高等级「在任考核」（保证特权与持续投入挂钩）。

### 1.4 对本项目的可借鉴结论

1. **能力阶梯直接映射**：评论（TL0/TL1）→ 行内评论（TL1/TL2）→ 提交编辑建议（TL2）→ 直接协作编辑他人文章（TL3）→ 板块级整理权（TL4/指派编辑）。Discourse 验证了「逐级解锁参与深度」对社区质量的有效性。
2. **指标设计要四维复合**：阅读量（潜水也算贡献）、参与量、被认可量（收到的赞/建议被采纳数）、无违规记录。对本项目尤其应加入「**编辑建议被采纳率**」作为晋升到协作编辑的核心指标——这是 Discourse 没有、但 wiki 式系统必需的。
3. **只让最高自动等级可降级 + 宽限期 + 锁定开关**：低成本防滥用，又不打击普通用户。
4. **所有阈值做成配置项**（站点设置表），冷启动期调低、社区成熟后调高。
5. Discourse 的 TL 是**全站一维**的；本项目有板块概念，建议保持「全站信任等级」一维不变（简单、可解释），板块级权力走指派制（板块管理员/编辑），避免二维信任矩阵的复杂度。

---

## 二、MediaWiki / 维基百科

### 2.1 修订存储模型：全文快照，而非增量 diff

MediaWiki 的核心决定：**每次编辑保存整页全文快照，diff 在展示时按需计算**（可缓存），从不以 diff 为存储真相。现行（MW 1.35+，多内容修订 MCR）模式下的表结构：

- `page`：页面元数据，指向最新修订（`page_latest`）。
- `revision`：每次编辑一行，含作者、时间戳、注释、`rev_parent_id`（构成修订链）。
- `slots`：revision ↔ content 的 n:m 关联（一个修订可含多个「槽」，如正文槽 + 元数据槽），每行仅约 25 字节。**未被本次编辑触及的槽直接继承父修订的 content 行**——这是天然的内容去重。
- `content`：不存正文本身，存**blob 地址 + SHA1 哈希 + 大小**等元数据。
- 实际文本在 `text` 表或 External Storage（独立 blob 集群，地址形如 URL），可批量压缩。

要点：**寻址靠哈希与地址、未变内容跨修订共享、diff 永远是派生品**——与 git 的 blob/tree 思想高度一致。

### 2.2 巡查（Patrol）

- 新页面与最近更改中，未巡查的编辑标红色感叹号「!」；拥有 `patrol` 权限的用户查看 diff 后标记「已巡查」，该标记进入日志。
- 受信任用户拥有 `autopatrol`：**自己的编辑自动视为已巡查**，把审核人力集中到新人/匿名编辑上。
- 本质是「**事后抽检队列**」：编辑即时生效，巡查只是消除待办，不阻塞发布。

### 2.3 回退（Rollback）

- `rollback` 权限提供**一键回退某页面顶部由同一用户连续做出的全部编辑**，自动生成编辑摘要、标记为小编辑，无需确认页——专为反破坏设计，社区规范要求仅用于明显破坏。
- 与之相对的 `undo`（人人可用）针对任意单个修订、需手动确认并填写摘要。
- 两者都不删除历史：回退本身也是一次新修订，全程可追溯。

### 2.4 保护（Protect）

按「编辑该页所需身份」分层，且**有期限、有日志**：

| 级别 | 谁能编辑 | 典型条件 |
|---|---|---|
| 半保护 | autoconfirmed（注册满 4 天 + 10 次编辑，enwiki 配置） | 持续 IP 破坏 |
| 扩展确认保护 | extended confirmed（30 天 + 500 编辑） | 争议性条目 |
| 模板保护 | 模板编辑员 | 高引用模板 |
| 全保护 | 仅管理员 | 编辑战 |

另有移动保护、创建保护（防重建）、级联保护（保护页面所嵌入的资源）。

### 2.5 待审核更改（FlaggedRevs / Pending Changes）

- 启用后页面有两个「别名」：**稳定版（stable）**与**当前版（current）**。未登录读者默认看到**最后一个被审核通过的稳定版**；新编辑成为「待审核更改」，登录用户与编辑者仍可见当前版。
- 拥有 reviewer 权限的用户在页面/diff 上有审核表单，审核通过则该修订成为新的稳定版；`autoreview` 权限让受信任用户的编辑自动通过（与 autopatrol 同构）。
- `Special:PendingChanges` 提供全站待审队列；监视列表与最近更改中未审修订标「!」。
- 部署形态很灵活：德语维基全站启用（「已检视版本」），英语维基只作为一种轻量保护级别（Pending Changes protection）用于特定页面。
- 与巡查的关键区别：**巡查是事后抽检（不阻塞读者所见），FlaggedRevs 是发布门禁（读者所见被挡在稳定版）**。

### 2.6 对本项目的可借鉴结论

1. **存储采用「全文/全块快照 + 哈希寻址 + 按需 diff」**，不要存增量。块级模型下成本更低：一次编辑只为变动的块产生新 blob，未变块跨修订共享（即 2.1 的 slot 继承思想）。
2. **「发布需审批」直接套用 stable/current 双指针模型**：每篇文章一个 `published_revision_id`（读者所见）+ `head_revision_id`（最新草稿/待审）。这比「草稿表 + 正式表」两套数据干净得多，且天然支持「已发布文章的后续修改也走审核」。
3. **信任等级挂接 autoreview/autopatrol**：高信任用户的编辑自动过审，把审核人力集中在新人身上——这是审批制项目能规模化的关键阀门。
4. **回退做成一等公民操作**：一键回退到任意历史修订＝创建一次新修订（绝不删历史），自动生成摘要并写审计日志；可限定高信任/编辑角色使用。
5. **保护级别与信任等级正交组合**：文章可设「最低编辑等级」（不限/TL2+/仅指派编辑/锁定），对应半保护→全保护谱系，且应支持**有效期**。
6. 巡查队列（`Special:PendingChanges` 的等价物）是审校工作流的中枢界面，第一天就要设计。

---

## 三、Google Docs 建议模式 与 GitHub Suggested Changes

这两者代表锚定建议的两种极端策略，值得对照分析。

### 3.1 Google Docs：建议「嵌入」文档模型（强锚定）

- **存储方式**：建议的文本**就是文档内容本身**。建议插入的文本直接进入文档流，打上 `suggestedInsertionIds`；建议删除的文本保留原位，打上 `suggestedDeletionIds`。每个建议有唯一 suggestion ID；同一段内容可携带多个 ID（嵌套建议、多人对同一处建议删除）。格式类建议另有 `suggestedTextStyleChanges` 等字段。
- **锚定与随动**：因为建议是文档内容的一部分，它**随操作变换（OT）与其他人的编辑自动移动**——别人在前面插入三段话，建议跟着后移；根本不存在「锚点失效」问题。这是「把建议做进数据模型」换来的代价与回报：代价是文档模型复杂化（每个渲染视图都要懂建议标记），回报是锚定永不漂移。
- **接受/拒绝**：接受插入＝抹掉插入标记使其成为正式内容；接受删除＝真正删除该文本。拒绝则相反。本质都是对标记的清算，且会进入修订历史。
- **三种渲染视图**（API 的 `suggestionsViewMode`）：`SUGGESTIONS_INLINE`（行内显示建议）、`PREVIEW_ACCEPTED`（预览全部接受后的样子）、`PREVIEW_WITHOUT_SUGGESTIONS`（预览全部拒绝）。
- 注意对照：Google Docs 的**评论**锚点用的是另一套机制（区间 + 引文），原文大改后会变成「孤儿评论」（orphaned，失去锚点但保留引文展示）——同一产品内，建议强锚定、评论弱锚定。
- API 限制：第三方只能读取建议，不能程序化创建/接受/拒绝。

### 3.2 GitHub：建议「挂」在版本快照上（弱锚定 + 显式失效）

- **存储方式**：suggestion 是 PR 行级评论里的一个 ```` ```suggestion ```` 代码块；评论记录锚定信息：`path` + `commit_id`（锚定时的提交）+ diff 中的行号/行区间（支持多行建议）。
- **接受**：作者或有写权限者点「Commit suggestion」，**在 PR 分支上直接生成一个真实 commit**；可把多个建议「Add to batch」合并为一个 commit。生成的 commit 把建议者署名为 `Co-authored-by`——贡献归属被保留。
- **限制**：只能对**出现在 PR diff 中的行**提建议（上下文未改动行、不在 diff 内的文件都不行）；PR 关闭/合并后不能再应用。
- **失效与重定位**：后续 commit（含 force-push）推上来后，GitHub 基于新旧 diff 重算评论位置——若被锚定的行仍能在新 diff 中对应上则**重定位**，对应不上（该行被修改/删除）则评论标记为 **outdated**：折叠归档、保留当时的 diff 上下文供回看，但 suggestion 不可再 apply。
- 本质：锚点 = (版本快照, 位置)。原文一变，宁可显式失效也不猜测——简单、可预期，但用户需重提建议。

### 3.3 两种策略对比

| | Google Docs | GitHub |
|---|---|---|
| 锚定对象 | 文档内容本身（标记） | 某 commit 的 diff 行号 |
| 原文变化后 | 自动随动，永不失效 | 尝试重定位，失败标 outdated |
| 接受动作 | 清算标记 | 生成真实 commit（保留 Co-author） |
| 模型成本 | 文档模型显著复杂化 | 模型极简，体验有损 |
| 适用场景 | 实时协作、高频修改 | 离散修订、评审节奏 |

### 3.4 对本项目的可借鉴结论

1. **块级模型提供了优于两者的第三条路**：建议/行内评论锚定为 `(blockId, 块内起止偏移, quotedText 引文, 基准 revisionId)`。块靠 ID 识别身份而非位置——**块被移动、前后插入新块时锚点零成本跟随**（解决了 GitHub 的主要痛点），又不必像 Google Docs 那样把建议标记织进内容模型。
2. **块内文本变化时的重定位降级链**：① 基准修订与当前修订相同 → 直接精确命中；② 不同 → 在该块新文本中模糊匹配 quotedText（前后文锚，类似 W3C Web Annotation 的 TextQuoteSelector）；③ 匹配失败 → 标记 **orphaned/outdated**，像 GitHub 一样**保留引文与当时上下文供回看**，绝不静默丢弃。
3. **建议的数据形态学 GitHub**：建议 = 「针对某块、基于某修订的一个 patch + 说明文字」，是独立实体（可讨论、可点赞、可进审核队列），而非文档内容。**接受建议 = 自动生成一次新修订**，作者署名为接受者、建议者记为 co-author——贡献归属直接喂给信任等级系统（「被采纳数」指标）。
4. **学 Google Docs 提供三视图**：审阅者应能切换「带建议标记的视图 / 全部接受预览 / 原文视图」，这对编辑建议审校工作流的体验至关重要。
5. 行内评论与编辑建议共用同一套锚定基础设施，只是 payload 不同（讨论 vs patch）——一次设计，两处复用。

---

## 四、Notion / ProseMirror 的块级文档模型

两者代表块身份问题的两种哲学：Notion 把身份做进数据模型，ProseMirror 故意不做身份、只做位置映射。

### 4.1 Notion：一切皆块，身份即 UUID

- **数据模型**：每个块一条记录：`{ id: UUIDv4, type, properties（标题、颜色等）, content: [子块ID有序数组], parent: 父块ID }`。整篇文档、页面、甚至工作区都是块。
- **双向指针各司其职**：`content` 数组（向下）决定**渲染顺序与嵌套结构**；`parent` 指针（向上）服务于**权限继承**——鉴权时沿 parent 链向上走，不必遍历整棵 content 树，这是大规模下的关键性能设计。
- **身份如何稳定**：UUID 在创建时分配，**与内容、类型、位置全部无关**。编辑文本＝改 `properties`；移动/缩进＝改父块的 `content` 数组与本块 `parent`；类型转换（段落→标题）＝改 `type` 字段、`properties` 尽量保留。ID 自始至终不变。
- **由此免费获得的能力**：行内评论、块链接（anchor link）、同步块（synced block）、双向引用全都只需引用 block ID；**跨修订追踪同一块**天然成立——「这个块的历史」就是按 block ID 过滤操作日志。
- **修订即操作日志**：客户端提交针对具体块的操作（op），服务端事务化应用；历史记录是 op 流的回放。

### 4.2 ProseMirror：不可变值树 + 位置映射

- **相反哲学**：文档是不可变的节点树，**节点是纯值，没有身份**——官方文档原话是应当「像对待数字 3 那样对待节点」，同一节点值可同时出现在多个数据结构中。位置是从文档头数起的整数偏移。
- **变更模型**：一切修改表达为 `Step` 序列（可逆、可序列化）。每个 Step 产生 `StepMap`，**把旧文档中的任意位置映射到新文档中的位置**（带 bias/assoc 参数控制插入点两侧的归属）；多个 StepMap 串成 `Mapping`。选区、装饰（Decoration，行内评论高亮的实现载体）、协同编辑的 rebase 全部建立在位置映射上。
- **块身份要自己加**：标准做法是给节点 schema 加 `id` attribute，用插件（`appendTransaction`）给缺 ID 或 ID 重复的节点分配 UUID。必须处理两个坑：**复制粘贴会复制 ID**（需查重重发）、**块分裂时两半携带同一 ID**（需指定哪半保留原 ID）。
- **协同**：官方 collab 模块走「中央权威 + 客户端 rebase」（类 OT）；社区主流替代是 Yjs 绑定（CRDT）。
- **工程上两者常结合**：用 ProseMirror（或其上层封装 Tiptap）做编辑器，顶层块各为一个带 `id` attr 的节点；持久化时按块拆成数据库记录——编辑态用 ProseMirror 的位置映射保证锚点实时跟随，落库态用块 ID 保证长期身份。

### 4.3 对本项目的可借鉴结论

1. **块 ID 用创建时分配的 UUID，独立于内容/类型/位置**（Notion 模式），所有锚定物（行内评论、建议、修订记录、块级永久链接）一律引用块 ID。这是整个系统的地基。
2. **块级 + 文档级双层修订，借 git 思想落地**：
   - 块内容寻址：`block_blob(hash, content)`——同一内容只存一份（即 MediaWiki slot 继承的推广）；
   - 文档修订 = 「有序的 (blockId → blobHash) 清单」+ 元数据（作者、时间、摘要、父修订）——即 git 的 tree + commit；
   - 「某块的历史」＝按 blockId 扫修订清单中 hash 变化的点；「某次修订改了什么」＝两份清单的集合 diff。两个核心追溯查询都变得平凡。
3. **显式处理分裂与合并，保住追溯链**：split 时一半保留原 ID、新块记 `derived_from: 原ID`；merge 时存活块记录被并入块的 ID。否则块历史会在重构时悄然断裂——这是 Notion/ProseMirror 都没替你解决、而本项目「历史必须可直观追溯」的需求必须解决的点。
4. **编辑器选 ProseMirror 系（建议 Tiptap 封装）**：成熟、可定制 schema、中文输入法兼容性好；用 unique-id 插件维护块 ID，编辑会话内靠 StepMap/Mapping 让行内锚点实时随动，保存时把锚点固化为 `(blockId, offset, quotedText, revisionId)` 落库——编辑态弱锚定 + 持久态强身份，两套机制各取所长。
5. **权限沿块树继承可学 Notion 的 parent 指针**，但本项目文章粒度的权限已够用，初期建议权限只到「文章级 + 板块级」，块级仅做锚定与修订，避免过度设计。

---

## 综合映射（一页结论）

| 项目需求 | 借鉴来源 | 落地形态 |
|---|---|---|
| 自下而上信任等级 | Discourse TL0–TL3 + 锁定/降级机制 | 阅读/互动/**建议采纳率**/违规四维指标，仅最高自动等级可降级 |
| 发布审批 | FlaggedRevs stable/current | 文章双指针：`published_revision` + `head_revision`；高信任用户 autoreview |
| 修订存储 | MediaWiki MCR + git tree/commit | 块 blob 哈希寻址 + 文档修订清单，未变块跨修订共享 |
| 编辑建议 | GitHub suggestion + Co-authored-by | 建议=独立实体（块级 patch），接受即生成署名修订 |
| 行内评论/建议锚定 | 块 ID（Notion）+ 引文降级（Web Annotation/GitHub outdated） | `(blockId, offset, quote, revisionId)`，重定位失败标 orphaned 并保留引文 |
| 回退/保护/巡查 | MediaWiki rollback/protect/patrol | 一键回退=新修订；文章最低编辑等级（带期限）；统一待审队列 |
| 编辑器 | ProseMirror/Tiptap + unique-id 插件 | 编辑态位置映射随动，持久态块 ID 锚定 |

## 参考来源

- [Understanding Discourse Trust Levels（官方博客）](https://blog.discourse.org/2018/06/understanding-discourse-trust-levels/)
- [Trust Level Permissions Reference — Discourse Meta](https://meta.discourse.org/t/trust-level-permissions-reference/224824)
- [Help:Extension:FlaggedRevs — MediaWiki](https://www.mediawiki.org/wiki/Help:Extension:FlaggedRevs)
- [Extension:FlaggedRevs — MediaWiki](https://www.mediawiki.org/wiki/Extension:FlaggedRevs)
- [Multi-Content Revisions — MediaWiki](https://www.mediawiki.org/wiki/Multi-Content_Revisions)
- [Manual:slots table / Manual:content table — MediaWiki](https://www.mediawiki.org/wiki/Manual:Slots_table)
- [Work with suggestions — Google Docs API](https://developers.google.com/workspace/docs/api/how-tos/suggestions)
- [Reviewing proposed changes in a pull request — GitHub Docs](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request)
- [Incorporating feedback in your pull request — GitHub Docs](https://docs.github.com/articles/incorporating-feedback-in-your-pull-request)
- [The data model behind Notion's flexibility — Notion 官方博客](https://www.notion.com/blog/data-model-behind-notion)
- [ProseMirror Guide（文档与位置模型）](https://prosemirror.net/docs/guide/)
- [prosemirror-transform README（Step/StepMap/Mapping）](https://github.com/ProseMirror/prosemirror-transform/blob/master/src/README.md)
- [Automatically setting default unique ID on each node — ProseMirror 论坛](https://discuss.prosemirror.net/t/automatically-setting-default-unique-id-on-each-node/2240)