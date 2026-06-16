# 0003. 修订模型采用类 git 内容寻址 + 稳定块身份 + 规范化树表

- 状态：已采纳
- 日期：2026-06-10
- 关联：docs/02-architecture.md §3

## 背景

需求要求细粒度多区块协作与「全历史可直观追溯」。修订模型一旦上线无法重做，是全项目唯一不可返工的决策。

## 决策

- `blobs`：单块内容寻址快照（sha256(canon(json))，含 `canon_version`），同内容天然去重；
- `blocks`：稳定块身份 UUID（含 `derived_from_block_id` 分裂血缘）；
- `revisions`：commit（parent + merge_parent、author/committer 双署名、文档内单调 seq、`schema_version`）；
- `revision_blocks`：规范化窄表树（修订→有序块清单），外键完整；
- `revision_changes`：物化逐块 diff（含 `merged_into_block_id` 合并血缘），块级 blame O(1)；
- `document_refs`：draft/published/suggestion 指针，全系统唯一可变状态，CAS 移动；
- `published_snapshots`：物化读路径（树表是真相，快照是缓存）；
- 合规删除走 `redactions` 墓碑通道（哈希保留，内容依法移除），是不可变历史的唯一例外。

## 备选方案

- **MediaWiki 式整页全文快照**：丢失块级追溯与行内锚定基础，落选。
- **存增量 diff**：重建任意修订需回放全链，历史浏览/对比性能不可控，落选（diff 永远是派生品）。
- **jsonb 整存 manifest**（原提案 A）：省 join 但丧失外键完整性、产生双份事实，评审后改为规范化树表。
- **Notion 式 op 日志为真相**：审计需要「离散的、有作者有消息的修订」，op 流不能直接充当法定历史，落选。

## 后果

- 正面：全历史精确追溯、blame O(1)、建议/回滚/审批共享同一套语义。
- 负面：每修订全量树行（窄行，量级可控）；预留冷分区与 delta 编码离线迁移路径。
- 跟进：canon 规范化算法与 PM schema 演进时必须递增版本号并提供迁移函数链。
