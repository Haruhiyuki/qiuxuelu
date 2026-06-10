# M0 对抗式评审结论与修复记录（2026-06-10）

> 流程：5 维度（内核算法/事务并发/鉴权治理/UGC 安全/schema 一致性）并行审查 → 每个发现由独立怀疑者反驳验证。
> 共 30 个候选发现，其中 11 个经对抗验证确认 + 5 个未验证候选经维护者人工裁决采纳，全部已修复；其余候选被反驳或裁决为设计取舍。

## 已确认并修复

| # | 严重度 | 问题 | 修复 |
|---|--------|------|------|
| 1 | major | drizzle 包装驱动错误，`err.code==='23505'` 判别恒 false，并发提交冲突文案失效 | `isUniqueViolation()` 沿 cause 链下钻（document.ts） |
| 2 | major | saveWorkingCopy 未经 can()，被制裁/停用作者仍可持续写工作副本 | 补 `can('doc.edit_direct')` 闸门 |
| 3 | major | 注册同意（CC BY-SA + 公约）仅前端校验，直连 API 可绕过且无留痕 | better-auth additionalFields 必填 + before 钩子校验版本号 + user 表落库凭证，三路实测 |
| 4 | major | 渲染器放行任意外链图片，审稿预览泄露审稿人 IP | M0 图片仅限站内来源，外源渲染占位框 |
| 5 | major | 审批工作台不按板块域收窄，板块 A 编辑可读板块 B 待审全文 | `publishableSectionIds()` 收窄列表与预览 |
| 6 | major | seed 的 trust.thresholds 形状与 domain TrustThresholds 全面漂移，M2 结算必然失效 | seed 对齐 domain 形状并双向互注 |
| 7 | major | publish_requests/suggestions 缺「不得自审」DB CHECK（架构 §5 双保险缺一半） | 迁移 0001 补两条 CHECK |
| 8 | major | db/domain 的 SanctionKind 与 publish_requests 状态机枚举漂移，靠 web 边界映射兜着 | domain 对齐 db 字面量（silence/no_suggest/no_edit/suspend；状态机加 withdrawn、去 draft 伪状态），删除映射层 |
| 9 | minor | 协议相对 URL（//host）被判为站内链接，绕过 nofollow/ugc 硬化 | isExternalUrl 显式处理 `//` 前缀 |
| 10 | minor | charsDelta 新旧值码点/码元口径不一 | JS 侧改按码点计数 |
| 11 | minor | audit_log.ip_hash 从不写入、session 存明文 IP，与隐私声明不符 | better-auth 关闭 IP 追踪；ip_hash 注释明确 M1 启用须 HMAC |

## 未验证候选 → 人工裁决采纳并修复

| # | 问题 | 修复 |
|---|------|------|
| 12 | **跨文档块身份劫持**：uuid 形 blockId 直通 + blocks 插入 onConflictDoNothing 静默吞冲突 | commitRevision 事务内显式校验树中每块属于本文档 |
| 13 | 审批通过后 documents.status=published 永远无法再次申请发布（改版滞留）；驳回无条件打回 draft 会误下架在线文章 | requestPublish 允许 draft/published；驳回按 published ref 是否存在恢复状态 |
| 14 | 工作副本基底落后于 draft 头时提交会静默丢更新 | commitRevision 校验 baseRevisionId === 当前头 |
| 15 | createDocument 的 can() 缺板块上下文，板块域制裁 fail-open | 传入 sectionId |
| 16 | can() 对缺 doc 上下文的 doc.edit_direct fail-open（绕过 edit_policy 与巡查义务） | fail-close；红线表补 user.trust_adjust；clampLevel 改严格断言 |
| 17 | kernel canon：键排序先于 NFC、数组 null 被剔除破坏位置语义、blob 存储未 NFC 归一 | 趁 CANON_VERSION=1 无存量数据全部修正（normalizeNfc 入库、键 NFC 后排序、碰撞抛错、数组 null 保位） |
| 18 | anchor 模糊滑窗可切进代理对内部；模糊命中后锚点永不收敛 | 码点边界收拢 + RemapResult 返回 matchedText |
| 19 | 自审禁令未覆盖「审批人=被审修订作者」 | checkReviewable 双维度判定 |
| 20 | 缺高频查询索引（blocks/comments/suggestions.document_id、队列轮询、鉴权热路径） | 迁移 0001 补 7 个索引 |

## 裁决为「设计取舍/暂不修」

- threeWayMerge 丢弃 theirs 侧纯重排——架构 §3.3 已声明块序以 ours 为准（风险登记簿有记录）。
- validateDoc 错误信息回显给编辑者——kernel 错误为刻意设计的中文可读文案，编辑器需要它定位问题；不含敏感信息。
- 锚点 remapped 永不回 live——matchedText 已提供收敛手段，worker 侧落地在 M2。
- slug_history 未接线——M1 改名功能范围，风险登记簿 + schema 注释均已标注 upsert 语义。

## 对抗验证否决的候选（示例）

- 「canonicalize 键排序问题导致生产哈希不稳」——docSchema 全 ASCII 键，生产不可达（仍按防御性修复）。
- kernel/txn/authz 维度部分候选因会话限额未完成机器验证，由维护者逐条人工裁决（见上表）。
