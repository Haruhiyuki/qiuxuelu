# ADR-0007：页面模式（私有 / 公共）与升级机制

状态：已接受
日期：2026-06-12
关联：ADR-0004（建议=分支）、ADR-0005（双线权限：裁决+义务）、架构 §4

## 背景

经验类个人文章默认归作者控制（私有），但当一篇文章积累了足够多的社区协作、被证明具有公共领域价值时，它应当从「某人的文章」升级为「社区共同维护的公共条目」。原有的 `documents.edit_policy`（suggest_only/open/semi/locked）只表达「编辑开放度」，无法表达这种**所有权 / 价值认可的生命周期**，也没有升级语义。

## 决策

### 1. 新增正交维度 `documents.visibility ∈ {private, public}`（默认 private）

- **私有页**：所有者控制。他人只能提编辑建议（owner 审），责任编辑可直编申请（进巡查）。
- **公共页**：内容被认可有公共价值。责任编辑接管审核管理，资深贡献者（TL3）可直编申请。
- `edit_policy='locked'` 仍是管理员最高冻结，**压过页面模式**（谁都不能直编）；其余 edit_policy 档位的「楼层」语义被 visibility 取代（locked 之外只看 visibility）。

### 2. 权限矩阵（映射到既有能力，不新增内容类能力）

| 行为 | 私有页 | 公共页 |
|---|---|---|
| 高级贡献者 TL3（非作者） | 编辑建议 `suggestion.create` | 编辑申请 `doc.edit_direct`（+巡查） |
| 责任编辑 editor（非作者） | 编辑申请 `doc.edit_direct` | 审核管理 `suggestion.review/merge` + 直编 |
| 所有者 | 审核管理 `suggestion.review/merge`（OWNER_CAPS TL2+） | 保留（不失权） |

- **「编辑申请」= `doc.edit_direct` + `enqueue_patrol` 义务**：直编立即生效但进巡查队列，与架构 §5「事前审批→事后巡查」梯度一致。「编辑建议」= 既有建议分支。能力阶梯：建议 < 申请 < 管理。
- `can()` 两处外科改动（其余判定顺序不变）：
  1. **角色线**：`editor` 角色的 `suggestion.review/merge` 受可见性门控——私有页不授予（管理权归所有者）；`section_mod` 及以上保留治理监督，不受此限。
  2. **信任线 `doc.edit_direct` 楼层**：由 visibility 驱动（locked→拒；public→TL3+ 进巡查；private→拒，policy_locked 文案引导改提建议）。

### 3. 升级（私有→公共）

- **自动**：私有页累计「他人贡献」≥ 阈值即升级。口径 = 非作者的（建议 + 可见评论含行内 + 他人署名的主线直编修订）之和。阈值入 `site_settings['doc.publicize'].threshold`（默认 20，**不硬编码**，遵守治理阈值红线）。检查点 `maybeAutoPromote` 挂在「新增他人贡献」的写路径后（建议创建/合入、评论创建），廉价幂等、失败不连累主流程。
- **手动**：管理员经新增能力 `doc.set_visibility`（ROLE_ONLY，section_mod+）一键升级。
- 升级是对内容公共价值的认可：用 CAS 防并发重复升级；写 `audit_log`（action=`doc.publicize`，高危操作红线）；**祝贺原作者**（`doc_promoted` 通知）；**原始作者身份保留**——`documents.owner_id` 不变，阅读端以「原作者」标注 + 「公共页面」徽章彰显。降级（public→private）当前不提供一键通道。

## 取舍与后果

- 选择新增 `visibility` 而非复用 `edit_policy`：二者语义正交（开放度 vs 价值认可生命周期），合流会让升级语义与管理员保护互相污染。代价是 `edit_policy` 的 open/semi/suggest_only 档位被边缘化（仅 locked 仍生效），属可接受的简化。
- `DocCtx.visibility` 为可选字段：旧数据/未携带上下文时按最严的 `private` 处理（fail-safe，非作者直编一律落入「请改提建议」）。
- 升级阈值与口径都可调（site_settings）；冷启动期可调低以让社区共建更早发生。
- 既有 `can()` 单测中「edit_policy 四档 × 信任楼层」用例改写为「私有/公共 × 信任楼层」，并新增管理权归属用例。
