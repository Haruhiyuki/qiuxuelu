# ADR-0016：贡献等级晋升改为积分制

状态：已接受
日期：2026-06-16
关联：取代既有多信号门控（架构 §4 信任结算）；涉及 ADR-0008（作者完整协作权）、ADR-0009（TL0 即可评论）、ADR-0010（协作三件套术语）

## 背景

原信任晋升为**多信号门控**：TL1 看账号年龄 + 活跃天数；TL2 看活跃天数 + 评论数；TL3 看
滚动窗口内的「修订申请合入数 + 被拒比例 + 举报命中率 + 活跃天数」多条件同时达标。维度多、
口径分散、用户难以预期「再做什么能升级」，且与「鼓励产出优质内容」的目标耦合不紧。

改为**单一贡献积分**：把各类有效贡献折算成分，等级由「是否发文 + 累计分 + 近一年窗口分」决定，
路径直观、可解释、可配置。

## 决策

晋升口径（阈值与计分权重均落 `site_settings['trust.thresholds']`，治理阈值不硬编码）：

| 等级 | 称谓 | 晋升条件 |
|----|----|----|
| TL0 | 新成员 | 注册即是 |
| TL1 | 成员 | 发布 1 篇文章 |
| TL2 | 贡献者 | 累计贡献满 **50** 分 |
| TL3 | 资深贡献者 | 近 **365** 天窗口内贡献满 **150** 分（窗口滑动，持续考核，跌破回落） |
| TL4 | 共建者 | 在 TL3 基础上由管理员**颁发认证**（人工授予，无自动路径） |

计分权重（一次动作得几分）：

| 动作 | 分 | 源表 |
|----|----|----|
| 发布文章 | +12 | `documents`（owner + status=published） |
| 行内批注 | +1 | `comments`（kind=inline + status=visible） |
| 编辑建议 | +2 | `feedback`（作者本人） |
| 修订申请被采纳 | +3 | `suggestions`（status=merged，窗口按 resolvedAt） |

- **可重放**红线不变：`recomputeTrust` 仍从源表纯派生 `TrustStats{publishedDocs, points, windowPoints}`
  → `computeLevel`，对同一用户多次调用结果一致；`trust_events` 仍只是看板辅助分账，不决定等级。
- **TL1 唯一门槛收紧为「发文」**：未发文的纯评论/批注用户停在 TL0（仍可评论，ADR-0009 不变），
  发首文即 TL1。移除原 TL1 的「账号年龄 + 活跃天数」旁路。
- 等级仍**逐级必达**、TL3 仍**可回落**（窗口分跌破阈值）、TL4 仍仅人工（锁定 manual_level）。
- 各级**能力**（协作权双线，TRUST_TIERS 的 priv/pub）不变——本 ADR 只改晋升口径，不改权限。

## 取舍与后果

- 移除 `windowDays/tl1/tl2/tl3` 旧阈值形状与 `TrustWindowStats`（suggestionsMerged/mergeRejectRatio/
  flagsAccuracy/activeDays），改为 `tl2Points/tl3WindowPoints/points{}`。`seed.ts` 与
  `apps/web/server/trust.ts` 的手抄阈值同步更新（依赖方向禁止 db import domain）。
- 不含数据库迁移：`user_trust` 表结构不变（分数运行时按源表算，不落库）；仅 `site_settings` 的
  JSON 值更新。上线时 prod 的 `trust.thresholds` 需改为新形状，否则 `loadThresholds` 回落到
  `DEFAULT_THRESHOLDS`（值相同，安全）。
- 防刷分：行内批注只计可见态（AI 审核/隐藏/删除不计）、修订合入需非作者裁决，难以低成本刷；
  编辑建议（feedback）计全部，刷分需大量可见编辑意见，由审核 + 制裁（负向 trust_events 监控）兜底。
- 取消了「被拒比例 / 举报命中率」对晋升的硬门控——这些信号转为巡查/制裁层面的治理手段，不再卡等级。
