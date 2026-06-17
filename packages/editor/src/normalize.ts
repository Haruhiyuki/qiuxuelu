// Tiptap JSON ↔ kernel DocJson 的节点名映射层。
//
// 命名映射表（双向，左 Tiptap / 右 kernel）：
//   bulletList ↔ bullet_list；orderedList ↔ ordered_list；listItem ↔ list_item；
//   codeBlock ↔ code_block；horizontalRule ↔ divider；hardBreak ↔ hard_break；
//   mark strike ↔ strikethrough；其余同名。
//
// 往返不变式（可测性约定）：对编辑器支持的子集 D 有
//   tiptapToKernel(kernelToTiptap(D)) 与 D 深度相等。
// 序列化细节（空 content / 空 marks / 空 attrs 一律省略键、link mark 只保留 href）
// 正是为保住该不变式与 canonicalize 哈希稳定而定的——改任何一侧前先想清楚另一侧。
//
// 全部 kernel 块型/标记均已在编辑器侧打通（figure/table/callout/math_block/highlight 不再降级）。
// 唯一有损点：表格 header 单元格归一为普通单元格（kernel table 无 header 概念）。
import type {
  BlockNode,
  CalloutNode,
  DocJson,
  InlineNode,
  InnerParagraphNode,
  ListItemNode,
  Mark,
  TableCellNode,
  TableRowNode,
} from '@harublog/kernel';
import type { JSONContent } from '@tiptap/core';

const HEADING_LEVELS = new Set([2, 3, 4]);

function readBlockId(node: JSONContent): string {
  const id = node.attrs?.blockId;
  if (typeof id === 'string' && id.length > 0) {
    return id;
  }
  // 编辑器侧 BlockId 插件保证顶层块必有身份；走到这里说明插件失效，宁可失败不可丢身份
  throw new Error(`顶层块（${node.type ?? '未知类型'}）缺少 blockId，请刷新页面后重试`);
}

/** 读取 Tiptap 段落/标题的块级排版（ADR-0017）：对齐仅 center/right，缩进 1–8；默认值省略。 */
function readBlockFormat(node: JSONContent): { align?: 'center' | 'right'; indent?: number } {
  const out: { align?: 'center' | 'right'; indent?: number } = {};
  const a = node.attrs?.textAlign;
  if (a === 'center' || a === 'right') {
    out.align = a;
  }
  const i = node.attrs?.indent;
  if (typeof i === 'number' && i >= 1) {
    out.indent = Math.min(8, Math.floor(i));
  }
  return out;
}

/** kernel 段落/标题 attrs → Tiptap attrs：把 align/indent 还原为 textAlign/indent（默认值不落键）。 */
function withBlockFormat(
  blockId: string,
  attrs: { align?: 'center' | 'right'; indent?: number },
): Record<string, unknown> {
  const out: Record<string, unknown> = { blockId };
  if (attrs.align !== undefined) {
    out.textAlign = attrs.align;
  }
  if (typeof attrs.indent === 'number' && attrs.indent >= 1) {
    out.indent = attrs.indent;
  }
  return out;
}

function toKernelMarks(marks: JSONContent['marks']): Mark[] {
  const out: Mark[] = [];
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case 'bold':
      case 'italic':
      case 'code':
        out.push({ type: mark.type });
        break;
      case 'strike':
        out.push({ type: 'strikethrough' });
        break;
      case 'highlight':
        // 高亮无 attrs（kernel highlight 不带颜色）；丢弃编辑器可能附带的 color
        out.push({ type: 'highlight' });
        break;
      case 'link': {
        const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '';
        if (href.length > 0) {
          // kernel link 是 strictObject：target/rel/class 等编辑器附属属性必须剥除
          out.push({ type: 'link', attrs: { href } });
        }
        break;
      }
      default:
        // 不支持的 mark（underline 等）静默剔除
        break;
    }
  }
  return out;
}

function toKernelInline(nodes: readonly JSONContent[] | undefined): InlineNode[] {
  const out: InlineNode[] = [];
  for (const node of nodes ?? []) {
    if (node.type === 'text' && typeof node.text === 'string' && node.text.length > 0) {
      const marks = toKernelMarks(node.marks);
      out.push(
        marks.length > 0
          ? { type: 'text', text: node.text, marks }
          : { type: 'text', text: node.text },
      );
    } else if (node.type === 'hardBreak') {
      out.push({ type: 'hard_break' });
    }
  }
  return out;
}

/** 递归收集段落：kernel 的 blockquote/list_item 只接受段落子节点，嵌套结构压平为段落序列。 */
function collectParagraphs(node: JSONContent): JSONContent[] {
  if (node.type === 'paragraph') {
    return [node];
  }
  return (node.content ?? []).flatMap(collectParagraphs);
}

function toInnerParagraphs(children: readonly JSONContent[] | undefined): InnerParagraphNode[] {
  const paragraphs: InnerParagraphNode[] = [];
  for (const para of (children ?? []).flatMap(collectParagraphs)) {
    const content = toKernelInline(para.content);
    paragraphs.push(content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' });
  }
  // kernel 要求容器子段落 min(1)：空容器补一个空段落
  return paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph' }];
}

function toListItems(children: readonly JSONContent[] | undefined): ListItemNode[] {
  return (children ?? [])
    .filter((child) => child.type === 'listItem')
    .map((item) => ({ type: 'list_item', content: toInnerParagraphs(item.content) }));
}

function toKernelBlock(node: JSONContent): BlockNode | null {
  switch (node.type) {
    case 'paragraph': {
      const blockId = readBlockId(node);
      const content = toKernelInline(node.content);
      const attrs = { blockId, ...readBlockFormat(node) };
      return content.length > 0
        ? { type: 'paragraph', attrs, content }
        : { type: 'paragraph', attrs };
    }
    case 'heading': {
      const blockId = readBlockId(node);
      const rawLevel = node.attrs?.level;
      const level = (typeof rawLevel === 'number' && HEADING_LEVELS.has(rawLevel) ? rawLevel : 2) as
        | 2
        | 3
        | 4;
      const content = toKernelInline(node.content);
      const attrs = { blockId, level, ...readBlockFormat(node) };
      return content.length > 0 ? { type: 'heading', attrs, content } : { type: 'heading', attrs };
    }
    case 'blockquote':
      return {
        type: 'blockquote',
        attrs: { blockId: readBlockId(node) },
        content: toInnerParagraphs(node.content),
      };
    case 'bulletList': {
      const items = toListItems(node.content);
      return items.length > 0
        ? { type: 'bullet_list', attrs: { blockId: readBlockId(node) }, content: items }
        : null;
    }
    case 'orderedList': {
      const items = toListItems(node.content);
      return items.length > 0
        ? { type: 'ordered_list', attrs: { blockId: readBlockId(node) }, content: items }
        : null;
    }
    case 'codeBlock': {
      const blockId = readBlockId(node);
      const language =
        typeof node.attrs?.language === 'string' && node.attrs.language.length > 0
          ? node.attrs.language
          : undefined;
      const content = (node.content ?? [])
        .filter(
          (child) =>
            child.type === 'text' && typeof child.text === 'string' && child.text.length > 0,
        )
        .map((child) => ({ type: 'text' as const, text: child.text as string }));
      const attrs = language === undefined ? { blockId } : { blockId, language };
      return content.length > 0
        ? { type: 'code_block', attrs, content }
        : { type: 'code_block', attrs };
    }
    case 'horizontalRule':
      return { type: 'divider', attrs: { blockId: readBlockId(node) } };
    case 'figure': {
      const blockId = readBlockId(node);
      const src = typeof node.attrs?.src === 'string' ? node.attrs.src : '';
      const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : '';
      const caption = typeof node.attrs?.caption === 'string' ? node.attrs.caption : '';
      // caption 空串省略，保住与 kernel（caption optional）的往返一致
      return caption.length > 0
        ? { type: 'figure', attrs: { blockId, src, alt, caption } }
        : { type: 'figure', attrs: { blockId, src, alt } };
    }
    case 'callout': {
      const blockId = readBlockId(node);
      const raw = node.attrs?.variant;
      const variant = (
        raw === 'tip' || raw === 'warn' || raw === 'danger' ? raw : 'info'
      ) as CalloutNode['attrs']['variant'];
      return {
        type: 'callout',
        attrs: { blockId, variant },
        content: toInnerParagraphs(node.content),
      };
    }
    case 'mathBlock': {
      const blockId = readBlockId(node);
      const latex = typeof node.attrs?.latex === 'string' ? node.attrs.latex : '';
      return { type: 'math_block', attrs: { blockId, latex } };
    }
    case 'table': {
      const blockId = readBlockId(node);
      const rows: TableRowNode[] = [];
      for (const row of node.content ?? []) {
        if (row.type !== 'tableRow') {
          continue;
        }
        const cells: TableCellNode[] = [];
        for (const cell of row.content ?? []) {
          if (cell.type !== 'tableCell' && cell.type !== 'tableHeader') {
            continue;
          }
          // kernel table_cell 内容是 inline[]（无 header 概念，header 归一为普通单元格）
          const inline = (cell.content ?? [])
            .flatMap(collectParagraphs)
            .flatMap((p) => toKernelInline(p.content));
          cells.push(
            inline.length > 0 ? { type: 'table_cell', content: inline } : { type: 'table_cell' },
          );
        }
        if (cells.length > 0) {
          rows.push({ type: 'table_row', content: cells });
        }
      }
      return rows.length > 0 ? { type: 'table', attrs: { blockId }, content: rows } : null;
    }
    default:
      // 不认识的顶层块直接丢弃——配置外的节点编辑器不会产生
      return null;
  }
}

/** Tiptap getJSON() → kernel DocJson（保存/提交前的唯一出口）。 */
export function tiptapToKernel(json: JSONContent): DocJson {
  if (json.type !== 'doc') {
    throw new Error('编辑器导出的根节点不是 doc');
  }
  const content: BlockNode[] = [];
  for (const child of json.content ?? []) {
    const block = toKernelBlock(child);
    if (block !== null) {
      content.push(block);
    }
  }
  return { type: 'doc', content };
}

function fromKernelMarks(marks: readonly Mark[] | undefined): JSONContent['marks'] {
  const out: NonNullable<JSONContent['marks']> = [];
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case 'bold':
      case 'italic':
      case 'code':
        out.push({ type: mark.type });
        break;
      case 'strikethrough':
        out.push({ type: 'strike' });
        break;
      case 'link':
        out.push({ type: 'link', attrs: { href: mark.attrs.href } });
        break;
      case 'highlight':
        out.push({ type: 'highlight' });
        break;
      default: {
        const exhausted: never = mark;
        void exhausted;
      }
    }
  }
  return out;
}

function fromKernelInline(nodes: readonly InlineNode[] | undefined): JSONContent[] {
  return (nodes ?? []).map((node) => {
    if (node.type === 'hard_break') {
      return { type: 'hardBreak' };
    }
    const marks = fromKernelMarks(node.marks);
    return marks !== undefined && marks.length > 0
      ? { type: 'text', text: node.text, marks }
      : { type: 'text', text: node.text };
  });
}

function fromInnerParagraphs(paragraphs: readonly InnerParagraphNode[]): JSONContent[] {
  return paragraphs.map((para) => {
    const content = fromKernelInline(para.content);
    return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
  });
}

/** kernel 单元格（inline[]）→ Tiptap 单元格内容（block+，包一层段落）。 */
function fromCellParagraphs(inline: readonly InlineNode[] | undefined): JSONContent[] {
  const content = fromKernelInline(inline);
  return [content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' }];
}

function fromKernelBlock(node: BlockNode): JSONContent {
  const blockId = node.attrs.blockId;
  switch (node.type) {
    case 'paragraph': {
      const content = fromKernelInline(node.content);
      const attrs = withBlockFormat(blockId, node.attrs);
      return content.length > 0
        ? { type: 'paragraph', attrs, content }
        : { type: 'paragraph', attrs };
    }
    case 'heading': {
      const content = fromKernelInline(node.content);
      const attrs = { ...withBlockFormat(blockId, node.attrs), level: node.attrs.level };
      return content.length > 0 ? { type: 'heading', attrs, content } : { type: 'heading', attrs };
    }
    case 'blockquote':
      return { type: 'blockquote', attrs: { blockId }, content: fromInnerParagraphs(node.content) };
    case 'bullet_list':
    case 'ordered_list':
      return {
        type: node.type === 'bullet_list' ? 'bulletList' : 'orderedList',
        attrs: { blockId },
        content: node.content.map((item) => ({
          type: 'listItem',
          content: fromInnerParagraphs(item.content),
        })),
      };
    case 'code_block': {
      const content = (node.content ?? []).map((t) => ({ type: 'text' as const, text: t.text }));
      const attrs = { blockId, language: node.attrs.language ?? null };
      return content.length > 0
        ? { type: 'codeBlock', attrs, content }
        : { type: 'codeBlock', attrs };
    }
    case 'divider':
      return { type: 'horizontalRule', attrs: { blockId } };
    case 'figure':
      return {
        type: 'figure',
        attrs: {
          blockId,
          src: node.attrs.src,
          alt: node.attrs.alt,
          caption: node.attrs.caption ?? '',
        },
      };
    case 'callout':
      return {
        type: 'callout',
        attrs: { blockId, variant: node.attrs.variant },
        content: fromInnerParagraphs(node.content),
      };
    case 'math_block':
      return { type: 'mathBlock', attrs: { blockId, latex: node.attrs.latex } };
    case 'table':
      return {
        type: 'table',
        attrs: { blockId },
        content: node.content.map((row) => ({
          type: 'tableRow',
          content: row.content.map((cell) => ({
            type: 'tableCell',
            content: fromCellParagraphs(cell.content),
          })),
        })),
      };
    default: {
      const exhausted: never = node;
      return exhausted;
    }
  }
}

/** kernel DocJson → Tiptap 初始内容（加载工作副本/快照回灌时的唯一入口）。 */
export function kernelToTiptap(doc: DocJson): JSONContent {
  if (doc.content.length === 0) {
    // PM doc 节点要求至少一个块；空段落无 blockId，由编辑器 BlockId 插件在 onCreate 补发
    return { type: 'doc', content: [{ type: 'paragraph' }] };
  }
  return { type: 'doc', content: doc.content.map(fromKernelBlock) };
}
