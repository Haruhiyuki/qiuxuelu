# ADR-0008：作者对自有文档的完整协作权

状态：已接受
日期：2026-06-13
关联：ADR-0004（建议=分支）、ADR-0005（双线权限）、ADR-0007（页面模式）

## 背景

原 `OWNER_CAPS` 给作者对自有文档的 `suggestion.review` / `suggestion.merge` 设了 **TL2 门槛**（架构 §5，及 ADR-0007 §2 权限矩阵中「所有者…(OWNER_CAPS TL2+)」标注）。但作者从 TL0 起就已能**直接编辑**自己的已发布文章（`doc.edit_direct` owner 楼层 = 0），却不能**审核 / 合并**别人对同一篇文章提交的编辑建议——这不自洽：作者本可把内容直接改成任何样子，却被挡在「以建议形式落地同一改动」之外。

## 决策

作者对自己的文档**从一开始（TL0）就拥有完整协作权**。`OWNER_CAPS` 的两个建议处置能力楼层由 TL2 降为 TL0：

| 能力 | 旧 owner 楼层 | 新 owner 楼层 |
|---|---|---|
| `doc.edit_direct` | TL0 | TL0（不变）|
| `doc.submit` | TL0 | TL0（不变）|
| `suggestion.review` | TL2 | **TL0** |
| `suggestion.merge` | TL2 | **TL0** |

- 仅对**自有文档**（`doc.ownerId === actor.id`）生效，经 `can()` 的所有权特例分支放行（`via='owner'`）。
- 仍受约束：**制裁一票否决**（`no_edit` 封 `suggestion.merge`、`suspend` 全封）仍优先；`edit_policy='locked'`（管理员强制保护）对 `doc.edit_direct` 仍压过作者自主权。审核/合并不涉直编、不受 locked 影响——合入产生的是新的主线修订，仍走修订模型，留痕可回退。
- **不触发布红线**：`doc.publish` / `doc.unpublish` 仍是 `ROLE_ONLY`（UGC 审批先行的内容安全闸不变），作者自助首发仍需编辑审校。

本 ADR **取代** ADR-0007 §2 权限矩阵中「所有者…(OWNER_CAPS TL2+)」一行的 TL2 标注（改为 TL0），其余不变。当前完整矩阵以 `docs/03-permissions.md` 为活文档。

## 取舍与后果

- **一致性 > 谨慎门槛**：作者既能直编，再卡住「审核自己文章的建议」没有保护价值，反而徒增困惑。
- **合并仍安全**：合入是修订模型内的操作，产生可追溯、可回退的主线修订，不绕过留痕。
- **影响面小**：仅 `OWNER_CAPS` 两个数值 + 对应 `can()` 单测；判定顺序与角色线/信任线/制裁均不变。
