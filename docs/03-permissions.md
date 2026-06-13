# 权限等级参考（活文档）

> 以代码为准：能力清单见 `packages/domain/src/authz/capabilities.ts`，判定逻辑见 `can.ts`。
> 关联：ADR-0005（双线权限）、ADR-0007（页面模式）、ADR-0008（作者完整协作权）。
> 本文是**活文档**（随代码更新）；ADR 是某次决策的时点记录。

## 骨架：两条线 + 一条红线

- **信任线（晋升给能力）**：TL0→TL4，随贡献**自动**解锁，给「能做事」的能力。
- **角色线（任命给权力）**：editor→section_mod→admin→superadmin，**人工授予**，给「管事」的权力。`editor` / `section_mod` **带板块作用域**（仅在被授板块生效），`admin` / `superadmin` **全局**。
- **红线 `ROLE_ONLY_CAPS`**：一组「权力型」能力**永不经信任线**，只能靠任命角色（见下）。

判定顺序（`can()` 唯一入口）：**停用 → 制裁 → 角色线 → 作者特例 → 信任线**。返回的是「**裁决 + 义务**」，不是布尔（如直编公共页附带 `enqueue_patrol`，TL0 评论附带 `pre_moderation`）。

## 信任线 TL0–TL4（累计；括号为该级新解锁）

| 等级 | 名称 | 累计能做 |
|---|---|---|
| **TL0** | 新成员 | 阅读、建草稿(`doc.create`)、提交审批(`doc.submit`)、举报(`flag.create`)；评论也能发，但**首帖预审 + 限速** |
| **TL1** | 成员 | ＋评论免预审(限速)、**行内批注**(`comment.inline.create`)、**传图**(`media.upload`) |
| **TL2** | 贡献者 | ＋对他人文章**提编辑建议**(`suggestion.create`) |
| **TL3** | 资深贡献者 | ＋在**公共页**直接编辑他人文章(`doc.edit_direct`，即时生效＋进巡查)；私有页仍只能提建议 |
| **TL4** | 共建者 | ＋**参与他人建议的审校**(`suggestion.review`)；无自动路径，由社区提名 + 管理员人工授予 |

## 角色线（累计；每级 = 前一级 ＋ 下列）

| 角色 | 作用域 | 新增权力 |
|---|---|---|
| **editor 责任编辑** | 板块 | 含信任线到 TL4 的全部 ＋ **发布/审校通过**(`doc.publish`)、**回退**(`doc.rollback`)、**认领巡查队列**(`queue.claim`)、**审校＋合并建议**(`suggestion.review`/`merge`) |
| **section_mod 板块版主** | 板块 | ＋评论管理(`comment.moderate`)、**处理举报**(`flag.review`)、**下架**(`doc.unpublish`)、**保护/锁定**(`doc.protect`)、**精选**(`doc.feature`)、**设为公共页**(`doc.set_visibility`) |
| **admin 管理员** | 全局 | ＋**封禁**(`user.suspend`)、**调信任等级**(`user.trust_adjust`，含授 TL4)、**授板块角色**(`role.grant_section`)、**管板块**(`section.manage`)、**发近闻/公告**(`announcement.manage`) |
| **superadmin 超管** | 全局 | ＋**授全局角色**(`role.grant_global`)、**系统配置**(`system.config`) |

> editor 例外：在**私有页**且非自己的文章上，editor **不获**「审核/合并建议」权（私有页的建议管理权只归作者；section_mod 及以上保留治理监督）。

## 红线 `ROLE_ONLY_CAPS`（信任线永远拿不到，只能任命）

`doc.publish`、`doc.unpublish`、`doc.protect`、`doc.feature`、`doc.set_visibility`、`flag.review`、`user.suspend`、`user.trust_adjust`、`role.grant_section`、`role.grant_global`、`section.manage`、`announcement.manage`、`system.config`。

一句话：**发布、下架、保护、精选、设可见性、处理举报、封人、调级、授角色、管板块、发公告、改系统**——全是任命来的权力，攒信任攒不到。

## 作者特例（对自己的文档，ADR-0008）

作者从 **TL0** 起就对自己的文章拥有完整协作权：

- **直接编辑**(`doc.edit_direct`)、**提交审批**(`doc.submit`)；
- **审核 + 合并**他人提交的编辑建议(`suggestion.review` / `suggestion.merge`)。

仍受约束：制裁仍一票否决；`edit_policy='locked'`（管理员强制保护）下作者也不能直编；首次**发布**仍需编辑审校（`doc.publish` 是红线，不自助）。

## 协作他人文章：公共页 / 私有页 两条线（ADR-0007）

同一个人，在**私有页**和**公共页**上能对**他人**文章做的事不同。能力阶梯：**建议 < 申请（直编+巡查） < 管理（审核/合并）**。

| 谁（非作者） | 🔒 私有页 | 🌐 公共页 |
|---|---|---|
| TL0–TL1 | 阅读 / 评论 / 举报 | 阅读 / 评论 / 举报 |
| TL2 贡献者 | **提编辑建议** | **提编辑建议** |
| TL3 资深贡献者 | **提编辑建议** | **编辑申请**＝直编 + 进巡查 |
| editor 责任编辑 | **编辑申请**＝直编 + 进巡查 | **审核管理**＝审核/合并建议 + 直编 |
| section_mod 及以上 | 审核管理 + 治理控件 | 审核管理 + 治理控件 |
| **作者本人** | **审核管理**（直编 + 审/合建议，TL0 起） | 保留，不失权 |

- **私有页**：作者掌控。他人最多到「申请」（editor 直编+巡查），审核管理权归作者。
- **公共页**：内容被认可有公共价值，责任编辑接管审核管理，TL3 可直编申请。
- **私有 → 公共升级**：私有页累计「他人贡献」（建议 + 他人评论/行内 + 他人署名的主线直编修订）≥ 阈值（`site_settings['doc.publicize'].threshold`，默认 20）自动升级；或管理员经 `doc.set_visibility` 手动升级。升级保留原作者身份（标「原作者」+「公共页面」徽章）。

## 制裁（一票否决，压过角色——治理红线高于职务）

| 制裁 | 封锁 |
|---|---|
| `silence` | 评论（含行内） |
| `no_suggest` | 提编辑建议 |
| `no_edit` | 建草稿 / 提交 / 直编 / 合并建议 / 传图 |
| `suspend` | 除阅读外全部 |

账号 `status=suspended` 早于一切判定（停用的 admin 也无权）。制裁可带板块作用域（仅该板块生效）或全站。
