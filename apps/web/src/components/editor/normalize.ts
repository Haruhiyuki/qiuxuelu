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
// 已知有损路径（仅 kernel → Tiptap 方向，加载编辑器不支持的旧块时触发）：
//   figure/table/callout/math_block 降级为纯文本段落（保留 blockId 维持身份）；
//   highlight mark 被剔除（M0 编辑器未装 highlight 扩展）。
import type {
  BlockNode,
  DocJson,
  InlineNode,
  InnerParagraphNode,
  ListItemNode,
  Mark,
} from '@harublog/kernel';
import { extractText } from '@harublog/kernel';
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
      case 'link': {
        const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '';
        if (href.length > 0) {
          // kernel link 是 strictObject：target/rel/class 等编辑器附属属性必须剥除
          out.push({ type: 'link', attrs: { href } });
        }
        break;
      }
      default:
        // M0 不支持的 mark（underline/highlight 等）静默剔除
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
      return content.length > 0
        ? { type: 'paragraph', attrs: { blockId }, content }
        : { type: 'paragraph', attrs: { blockId } };
    }
    case 'heading': {
      const blockId = readBlockId(node);
      const rawLevel = node.attrs?.level;
      const level = (typeof rawLevel === 'number' && HEADING_LEVELS.has(rawLevel) ? rawLevel : 2) as
        | 2
        | 3
        | 4;
      const content = toKernelInline(node.content);
      return content.length > 0
        ? { type: 'heading', attrs: { blockId, level }, content }
        : { type: 'heading', attrs: { blockId, level } };
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
    default:
      // 不认识的顶层块直接丢弃——M0 配置下编辑器不会产生
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

function fromKernelBlock(node: BlockNode): JSONContent {
  const blockId = node.attrs.blockId;
  switch (node.type) {
    case 'paragraph': {
      const content = fromKernelInline(node.content);
      return content.length > 0
        ? { type: 'paragraph', attrs: { blockId }, content }
        : { type: 'paragraph', attrs: { blockId } };
    }
    case 'heading': {
      const content = fromKernelInline(node.content);
      const attrs = { blockId, level: node.attrs.level };
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
    case 'table':
    case 'callout':
    case 'math_block': {
      // 有损降级：M0 编辑器不支持这些块，回退为纯文本段落（保留 blockId 维持身份）
      const text = extractText(node).replaceAll('\n', ' ').trim();
      return text.length > 0
        ? { type: 'paragraph', attrs: { blockId }, content: [{ type: 'text', text }] }
        : { type: 'paragraph', attrs: { blockId } };
    }
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
