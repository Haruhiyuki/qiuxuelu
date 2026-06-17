import { z } from 'zod';

/** ProseMirror 文档 schema 版本；节点集/attrs 语义变化时必须递增并提供迁移函数链（ADR-0003 跟进项）。 */
// v2（ADR-0017）：段落/标题新增可选 align/indent 块级排版属性。
export const SCHEMA_VERSION = 2;

// 块身份由编辑器插件注入、服务端校验唯一性；空串无法充当外键，直接拒绝。
const blockIdSchema = z.string().min(1);

// 块级排版（ADR-0017）：对齐只存非默认值（left 默认 → 省略）；缩进 1–8 级（0 默认 → 省略）。
// 默认值一律省略，保证旧文档与未排版块的内容寻址哈希不变（canonicalize 见不到该键 = 哈希同旧）。
const alignSchema = z.enum(['center', 'right']);
const indentSchema = z.number().int().min(1).max(8);

const markSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('bold') }),
  z.strictObject({ type: z.literal('italic') }),
  z.strictObject({ type: z.literal('code') }),
  z.strictObject({ type: z.literal('strikethrough') }),
  z.strictObject({ type: z.literal('highlight') }),
  z.strictObject({ type: z.literal('link'), attrs: z.strictObject({ href: z.string().min(1) }) }),
]);

// 空 text 节点与空 marks 数组均被拒绝：canonicalize 只剔除 null/undefined 与空 attrs，
// 若放行 `marks: []` 会让同一内容产生两种哈希，破坏内容寻址去重。
const textSchema = z.strictObject({
  type: z.literal('text'),
  text: z.string().min(1),
  marks: z.array(markSchema).min(1).optional(),
});

const hardBreakSchema = z.strictObject({ type: z.literal('hard_break') });

const inlineSchema = z.discriminatedUnion('type', [textSchema, hardBreakSchema]);

// 块内子段落：blockId 只发给顶层块（协作/锚定的原子单位），子段落不要求身份。
const innerParagraphSchema = z.strictObject({
  type: z.literal('paragraph'),
  attrs: z.strictObject({ blockId: blockIdSchema.optional() }).optional(),
  content: z.array(inlineSchema).optional(),
});

const paragraphSchema = z.strictObject({
  type: z.literal('paragraph'),
  attrs: z.strictObject({
    blockId: blockIdSchema,
    align: alignSchema.optional(),
    indent: indentSchema.optional(),
  }),
  content: z.array(inlineSchema).optional(),
});

// h1 留给文章标题（独立字段），正文层级收敛为 2-4。
const headingSchema = z.strictObject({
  type: z.literal('heading'),
  attrs: z.strictObject({
    blockId: blockIdSchema,
    level: z.union([z.literal(2), z.literal(3), z.literal(4)]),
    align: alignSchema.optional(),
    indent: indentSchema.optional(),
  }),
  content: z.array(inlineSchema).optional(),
});

const blockquoteSchema = z.strictObject({
  type: z.literal('blockquote'),
  attrs: z.strictObject({ blockId: blockIdSchema }),
  content: z.array(innerParagraphSchema).min(1),
});

const listItemSchema = z.strictObject({
  type: z.literal('list_item'),
  content: z.array(innerParagraphSchema).min(1),
});

const bulletListSchema = z.strictObject({
  type: z.literal('bullet_list'),
  attrs: z.strictObject({ blockId: blockIdSchema }),
  content: z.array(listItemSchema).min(1),
});

const orderedListSchema = z.strictObject({
  type: z.literal('ordered_list'),
  attrs: z.strictObject({ blockId: blockIdSchema }),
  content: z.array(listItemSchema).min(1),
});

// 代码块内容是纯 text（无 marks），与 ProseMirror code 节点语义一致。
const codeTextSchema = z.strictObject({
  type: z.literal('text'),
  text: z.string().min(1),
});

const codeBlockSchema = z.strictObject({
  type: z.literal('code_block'),
  attrs: z.strictObject({ blockId: blockIdSchema, language: z.string().optional() }),
  content: z.array(codeTextSchema).optional(),
});

const figureSchema = z.strictObject({
  type: z.literal('figure'),
  attrs: z.strictObject({
    blockId: blockIdSchema,
    src: z.string().min(1),
    alt: z.string(),
    caption: z.string().optional(),
  }),
});

const tableCellSchema = z.strictObject({
  type: z.literal('table_cell'),
  content: z.array(inlineSchema).optional(),
});

const tableRowSchema = z.strictObject({
  type: z.literal('table_row'),
  content: z.array(tableCellSchema).min(1),
});

const tableSchema = z.strictObject({
  type: z.literal('table'),
  attrs: z.strictObject({ blockId: blockIdSchema }),
  content: z.array(tableRowSchema).min(1),
});

const calloutSchema = z.strictObject({
  type: z.literal('callout'),
  attrs: z.strictObject({
    blockId: blockIdSchema,
    variant: z.enum(['info', 'tip', 'warn', 'danger']),
  }),
  content: z.array(innerParagraphSchema).min(1),
});

const dividerSchema = z.strictObject({
  type: z.literal('divider'),
  attrs: z.strictObject({ blockId: blockIdSchema }),
});

const mathBlockSchema = z.strictObject({
  type: z.literal('math_block'),
  attrs: z.strictObject({ blockId: blockIdSchema, latex: z.string() }),
});

export const blockNodeSchema = z.discriminatedUnion('type', [
  paragraphSchema,
  headingSchema,
  blockquoteSchema,
  bulletListSchema,
  orderedListSchema,
  codeBlockSchema,
  figureSchema,
  tableSchema,
  calloutSchema,
  dividerSchema,
  mathBlockSchema,
]);

// blockId 全文档唯一是修订模型的根基不变式（架构 §6 指明由 kernel 负责校验）。
export const docSchema = z
  .strictObject({
    type: z.literal('doc'),
    content: z.array(blockNodeSchema),
  })
  .superRefine((doc, ctx) => {
    const seen = new Set<string>();
    for (const [i, node] of doc.content.entries()) {
      const id = node.attrs.blockId;
      if (seen.has(id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['content', i, 'attrs', 'blockId'],
          message: `blockId 重复：'${id}'（块身份必须全文档唯一）`,
        });
      }
      seen.add(id);
    }
  });

export type Mark = z.infer<typeof markSchema>;
export type TextNode = z.infer<typeof textSchema>;
export type HardBreakNode = z.infer<typeof hardBreakSchema>;
export type InlineNode = z.infer<typeof inlineSchema>;
export type InnerParagraphNode = z.infer<typeof innerParagraphSchema>;
export type ParagraphNode = z.infer<typeof paragraphSchema>;
export type HeadingNode = z.infer<typeof headingSchema>;
export type BlockquoteNode = z.infer<typeof blockquoteSchema>;
export type ListItemNode = z.infer<typeof listItemSchema>;
export type BulletListNode = z.infer<typeof bulletListSchema>;
export type OrderedListNode = z.infer<typeof orderedListSchema>;
export type CodeTextNode = z.infer<typeof codeTextSchema>;
export type CodeBlockNode = z.infer<typeof codeBlockSchema>;
export type FigureNode = z.infer<typeof figureSchema>;
export type TableCellNode = z.infer<typeof tableCellSchema>;
export type TableRowNode = z.infer<typeof tableRowSchema>;
export type TableNode = z.infer<typeof tableSchema>;
export type CalloutNode = z.infer<typeof calloutSchema>;
export type DividerNode = z.infer<typeof dividerSchema>;
export type MathBlockNode = z.infer<typeof mathBlockSchema>;
export type BlockNode = z.infer<typeof blockNodeSchema>;
export type DocJson = z.infer<typeof docSchema>;

/**
 * 校验并返回文档 JSON；校验失败抛出带可读中文摘要的 Error。
 * 服务端提交、合并落盘前都必须经过这道门。
 */
export function validateDoc(json: unknown): DocJson {
  const result = docSchema.safeParse(json);
  if (!result.success) {
    throw new Error(
      `文档校验失败（schema v${SCHEMA_VERSION}）：\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}
