# ADR-0012：退役实时协作，并发统一到修订层三方合并

状态：已接受
日期：2026-06-14
关联：ADR-0004（修订模型与三方合并）、ADR-0010（协作三件套）、架构 §6.3（实时协作 C 阶）

## 背景

并发「多人改同一篇文章」在系统里其实分两层，原本由两套不相干的机制处理：

1. **实时键入级**（两人同一时刻在同一草稿里敲字）——由 **C 阶实时协作**（`apps/collab`：Hocuspocus + Yjs CRDT，架构 §6.3）处理：共享 Y.Doc、CRDT 自动合并、presence 光标，防抖缝合成 `collab_checkpoint` 修订。
2. **修订提交级**（两人各自把版本落成正式修订 / 发布）——由修订层处理：`commitRevision` / `directEditPublished` 用 **CAS 移 ref**，撞到「基底落后 / ref 已变」就**直接拒绝**「请刷新页面后重试」，让用户丢工作、手动重做。

两点观察：

- 实时协作（C 阶）对一个**学习经验站**是过度工程：它复杂（CRDT 持久性、会话归因——见下）、未在测试站部署、且学习站的真实协作形态是**异步**的（你改你的、我改我的，回头合），不是同屏抢编辑。其缝合层还遗留一个未解的归因问题：一次 checkpoint 合并了多人并发编辑，却只能署名给文档 owner（co-author 追踪未做）。
- 与此同时，系统**已有**成熟的三方块级合并（`kernel threeWayMerge`：单侧改动自动消解、快进、真冲突逐块裁决），但只用在**修订申请（suggestion）**一条路径上；直接提交路径完全没用它，撞并发就粗暴拒绝。

即：真正有价值的并发处理（合理合并而非丢工作）已经有能力，只是没铺到该铺的地方；而投入大的实时协作反而价值低。

## 决策

**一、退役 C 阶实时协作。** 移除 `apps/collab`、`/write/[docId]/collab` 路由、`realtime-editor`、协作 token（`issueCollabToken` / `collab-token`）、编辑器的 `Collaboration`/`CollaborationCaret`/`COLLAB_FRAGMENT` 接入，以及 `@hocuspocus/*` / `yjs` / `y-prosemirror` 依赖。git 历史保留，未来若确有同屏协同需求可寻回。

**二、并发提交统一到修订层三方合并。** `commitRevision` 与 `directEditPublished` 撞「基底落后 / CAS 冲突」时，不再拒绝，改为三方合并：

```
base   = 我开始编辑时的基底修订（工作副本 baseRevisionId）
theirs = 当前最新头（其他会话已提交的）
ours   = 我的新内容
threeWayMerge(base, ours, theirs)
  ├─ 无冲突（改了不同块 / 快进 / 殊途同归） → 自动合并，提交成功（不再丢工作）
  └─ 有冲突（同一块两人都改）            → 返回 conflicts，进三栏逐块裁决，
                                          裁决后 applyResolutions 落成合并修订
```

复用 suggestion 路径已验证的 `threeWayMerge` / `applyResolutions` / `ConflictView` 与三栏裁决体验（抽成 `server/merge.ts` 共享）。

## 取舍与后果

- **修订模型语义不变**（守红线）：仍内容寻址 blob、修订不可变、`document_refs` 唯一可变指针、CAS 移 ref；合并产出的是一次**正常的新修订**（parent = theirs，内容 = 合并结果），与 suggestion 的 merge commit 同构。本 ADR 改的是**冲突处理策略**（拒绝 → 合并 / 裁决），不是模型本身。
- **取代**架构 §6.3 实时协作 C 阶（退役）与 `commitRevision`「撞并发即拒绝重试」的旧行为；ADR-0010 的协作三件套（修订 / 修订申请 / 编辑建议）不受影响，反而更自洽——直接提交也享有与 suggestion 同级的合并能力。
- **失去**同屏实时协同与 presence 光标（少数高价值场景）。判断：学习站不需要，异步并发合并已覆盖真实需求。
- **得到**：并发改同一篇不再丢工作（绝大多数改不同块的情况自动合）；维护面与包体积减小（去掉 CRDT 全家桶）；归因问题随之消失（每次提交仍是单一 actor，blame/信任结算清晰）。
- **影响面**：删除约 5 个文件 + 1 个 app + 编辑器协作扩展 + 依赖；`commitRevision`/`directEditPublished` 改为 merge-aware + 新增冲突裁决动作与 UI（复用 suggestion resolve）。无 DB schema 变更。
