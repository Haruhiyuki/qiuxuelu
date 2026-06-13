# ADR-0011：文档编辑策略简化为二元（锁定 / 开放）

状态：已接受
日期：2026-06-13
关联：ADR-0005（双线权限）、ADR-0007（页面模式）、ADR-0008（作者完整协作权）

## 背景

`documents.edit_policy` 原设四档梯度（架构 §4.1）：

```
suggest_only(默认) | open(TL2+直编,巡查) | semi(TL3+直编,巡查) | locked(仅角色线)
```

ADR-0007 引入页面模式（private/public）后，「谁能直编」已由 **可见性 × 信任 × 所有权 × 角色** 共同裁决：私有页只有所有者/编辑能改、公共页 TL3+ 直编进巡查。ADR-0007 当时即记录「`edit_policy` 的 open/semi/suggest_only 档位被边缘化（仅 locked 仍生效），属可接受的简化」。

事实印证：`can()` 全代码里 `editPolicy` 只被读作 `=== 'locked'` 一处判断（所有权特例豁免 + `doc.edit_direct` 楼层冻结）。`suggest_only` / `open` / `semi` 三档对裁决**完全等价**——它们只是「非 locked」。保留四档徒增配置面与认知负担，却无任何行为差异。

## 决策

把 `edit_policy` 收敛为二元：

| 取值 | 语义 |
|---|---|
| `open`（默认） | 正常——是否可直编交由权限系统（信任/所有权/角色/可见性）裁决 |
| `locked` | 管理员强制锁定——谁都不能直编，只能提修订申请 / 编辑建议（走修订模型） |

- **行为零变化**：`can()` 逻辑一字未改（本就只看 `locked`）；合并后的 `open` 与原 `suggest_only/semi/open` 在裁决上完全一致。
- **类型**：`EditPolicy = 'open' | 'locked'`（`packages/domain/src/authz/types.ts`）。
- **DB**：`edit_policy` 默认 `'open'`，CHECK 收为 `in ('open','locked')`（迁移 0022）。数据回填 `suggest_only`/`semi` → `open`，`locked` 原样保留。
- **UI**：文章页治理条的四选下拉改为单个「锁定编辑 / 已锁定编辑」开关（`doc.protect` 能力不变，仍归 section_mod+）。
- **锁定语义不变**：`locked` 仍是管理员最高冻结，压过页面模式与作者自主权（ADR-0008 §仍受约束 继续成立）。

## 取舍与后果

- **简化 > 表达力**：四档梯度的表达力在页面模式接管后已成空头支票；删掉死配置比保留「看似可调实则等价」的旋钮更诚实。
- **不可逆性可接受**：`suggest_only`/`semi` 语义已无处承载，回退也只能回到等价的 `open`，无信息损失。
- **影响面**：`EditPolicy` 类型 + `setEditPolicy` 动作白名单 + 治理条 UI + 各处 `DocCtx` 字面量 + 迁移 0022（含一次性回填）；判定顺序、信任线、角色线、制裁一律不变。

本 ADR 取代架构 §4.1「文档编辑策略」四档表述（改为二元），其余不变；活文档以 `docs/03-permissions.md` 为准。
