# ADR-0017：段落/标题支持对齐与缩进（schema v2）

状态：已接受
日期：2026-06-17
关联：ADR-0003（修订模型 / SCHEMA_VERSION）；涉及 kernel schema、@harublog/editor、renderer

## 背景

编辑器缺少基本的块级排版：文本对齐（左/中/右）与缩进。这两项是富文本的常规能力，但本项目
文档模型由 kernel 严格定义（`z.strictObject` 逐块枚举 attrs、内容寻址哈希、normalize 双向往返），
不能在编辑器侧随意附加属性——未登记的 attr 会被 `validateDoc` 拒绝。

## 决策

为**顶层段落与标题**新增两个可选块级属性，纳入 kernel schema（v1 → **v2**）：

- `align`: `'center' | 'right'`（**left 为默认，一律省略不存**）。
- `indent`: 整数 `1–8`（**0 为默认，省略不存**）。

要点：

- **默认值省略**保内容寻址哈希稳定：旧文档与未排版的块不带这两个键，`canonicalize` 见不到 →
  哈希与 v1 完全一致，无需数据迁移（且本仓库无 schema 版本比较/迁移逻辑，version 仅作标记）。
- **CANON_VERSION 不变**：canonicalize 对 attrs 是通用处理，新增 attr 键不改变其算法语义。
- **编辑器**（`@harublog/editor`）：自定义 `BlockFormatting` 扩展（不引第三方依赖）给 paragraph/heading
  加 `textAlign`/`indent` 属性 + 命令；`Tab`/`Shift-Tab` 增减缩进，**列表内的 Tab 仍交给列表扩展**
  做层级缩进（互不抢键）。normalize 双向映射 `textAlign↔align`、`indent↔indent`，默认值两侧都省略。
- **渲染器**：对齐输出 `text-align`，缩进按级换算 `padding-inline-start`（每级 2em）。值均来自
  kernel 已校验的枚举/整数，经 React `style` 输出——**无字符串注入面，不碰 dangerouslySetInnerHTML**（UGC XSS 红线）。

## 取舍与后果

- **仅顶层段落/标题**支持：列表项 / 引用块 / 提示框 / 表格内的子段落（`innerParagraph`，无 blockId）
  不带 align/indent；编辑器里对嵌套段落按 Tab/对齐会在保存时被 normalize 丢弃（与「表格 header
  归一为普通单元格」同类的有损边界）。需要时再以新 ADR 扩展到子段落。
- 旧 revision 的 `documents.schema_version` 仍是 1；新写入记 2。因 v1 文档在 v2 schema 下依然合法
  （新属性可选），无回填、无迁移函数。
- `indent` 上限 8 级、`align` 不含 `justify`，是刻意的保守集合，避免排版自由度过高破坏阅读一致性。
