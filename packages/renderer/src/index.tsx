// @harublog/renderer —— ProseMirror JSON → React（RSC 安全：零 hooks、零浏览器 API）。
// XSS 红线声明：本包全程不使用 dangerouslySetInnerHTML，一切文本经 React 默认转义输出；
// 唯一需要人工把关的注入面是 URL 属性（a[href] / img[src]），由 isSafeUrl 统一守门。

import type {
  BlockNode,
  CalloutNode,
  DocJson,
  HeadingNode,
  InlineNode,
  InnerParagraphNode,
  ListItemNode,
  Mark,
  TableNode,
} from '@harublog/kernel';
import { extractText, validateDoc } from '@harublog/kernel';
import type { ReactElement, ReactNode } from 'react';
import { Fragment } from 'react';

export { RevisionDiffView, type RevisionDiffViewProps } from './revision-diff';

/**
 * UGC 链接安全是红线：只放行 http(s)/mailto 与站内相对路径，
 * javascript:/data:/vbscript: 等可执行 scheme 一律拒绝（拒绝时降级为纯文本，不渲染 <a>）。
 */
function isSafeUrl(href: string): boolean {
  return /^(https?:\/\/|mailto:|\/|#|\?|\.\.?\/)/i.test(href);
}

/**
 * http(s) 绝对地址且 origin 不等于本站 origin 才算外链；相对路径天然站内。
 * 协议相对地址（//host）会被浏览器解析为跨源绝对地址，必须按外链处理，
 * 否则可借此写法逃过 nofollow/ugc 硬化。
 */
function isExternalUrl(href: string, siteOrigin: string | undefined): boolean {
  if (href.startsWith('//')) {
    return true;
  }
  if (!/^https?:\/\//i.test(href)) {
    return false;
  }
  if (siteOrigin === undefined) {
    return true;
  }
  try {
    return new URL(href).origin !== new URL(siteOrigin).origin;
  } catch {
    return true;
  }
}

/**
 * 图片来源策略（M0）：仅放行站内相对路径与本站 origin——
 * 任意第三方图源会把读者（尤其审稿人）的 IP/UA 暴露给作者可控的服务器，
 * 构成对审稿人的盲打追踪面；待 M1 接入站内图床/白名单后再放宽。
 */
function isAllowedImageSrc(src: string, siteOrigin: string | undefined): boolean {
  if (!isSafeUrl(src) || src.startsWith('//')) {
    return false;
  }
  if (!/^https?:\/\//i.test(src)) {
    return true; // 站内相对路径
  }
  if (siteOrigin === undefined) {
    return false;
  }
  try {
    return new URL(src).origin === new URL(siteOrigin).origin;
  } catch {
    return false;
  }
}

function renderLink(href: string, siteOrigin: string | undefined, children: ReactNode): ReactNode {
  if (!isSafeUrl(href)) {
    return children;
  }
  if (isExternalUrl(href, siteOrigin)) {
    // UGC 平台对外链统一加 nofollow（防 SEO 垃圾）+ noopener（防 window.opener 劫持）+ ugc 语义标注。
    return (
      <a href={href} rel="nofollow noopener ugc" target="_blank">
        {children}
      </a>
    );
  }
  return <a href={href}>{children}</a>;
}

function applyMark(mark: Mark, siteOrigin: string | undefined, children: ReactNode): ReactNode {
  switch (mark.type) {
    case 'bold':
      return <strong>{children}</strong>;
    case 'italic':
      return <em>{children}</em>;
    case 'code':
      return <code>{children}</code>;
    case 'strikethrough':
      return <s>{children}</s>;
    case 'highlight':
      return <mark>{children}</mark>;
    case 'link':
      return renderLink(mark.attrs.href, siteOrigin, children);
    default: {
      const exhausted: never = mark;
      return exhausted;
    }
  }
}

function renderInline(
  nodes: readonly InlineNode[] | undefined,
  siteOrigin: string | undefined,
): ReactNode {
  return (nodes ?? []).map((node, i) => {
    if (node.type === 'hard_break') {
      return <br key={i} />;
    }
    // reduceRight 让 marks[0] 成为最外层包裹，与 ProseMirror DOMSerializer 的嵌套顺序一致。
    const wrapped = (node.marks ?? []).reduceRight<ReactNode>(
      (children, mark) => applyMark(mark, siteOrigin, children),
      node.text,
    );
    return <Fragment key={i}>{wrapped}</Fragment>;
  });
}

function renderInnerParagraphs(
  paragraphs: readonly InnerParagraphNode[],
  siteOrigin: string | undefined,
): ReactNode {
  return paragraphs.map((p, i) => <p key={i}>{renderInline(p.content, siteOrigin)}</p>);
}

function renderListItems(
  items: readonly ListItemNode[],
  siteOrigin: string | undefined,
): ReactNode {
  return items.map((item, i) => <li key={i}>{renderInnerParagraphs(item.content, siteOrigin)}</li>);
}

function renderHeading(
  node: HeadingNode,
  headingAnchors: boolean,
  siteOrigin: string | undefined,
): ReactElement {
  const Tag = `h${node.attrs.level}` as 'h2' | 'h3' | 'h4';
  return (
    <Tag>
      {renderInline(node.content, siteOrigin)}
      {headingAnchors ? (
        <a className="block-anchor" href={`#b-${node.attrs.blockId}`} aria-label="本节链接">
          #
        </a>
      ) : null}
    </Tag>
  );
}

function renderCallout(node: CalloutNode, siteOrigin: string | undefined): ReactElement {
  return (
    <aside className={`callout callout-${node.attrs.variant}`}>
      {renderInnerParagraphs(node.content, siteOrigin)}
    </aside>
  );
}

function renderTable(node: TableNode, siteOrigin: string | undefined): ReactElement {
  return (
    <table>
      <tbody>
        {node.content.map((row, ri) => (
          <tr key={ri}>
            {row.content.map((cell, ci) => (
              <td key={ci}>{renderInline(cell.content, siteOrigin)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function renderBlockContent(
  node: BlockNode,
  headingAnchors: boolean,
  siteOrigin: string | undefined,
): ReactNode {
  switch (node.type) {
    case 'paragraph':
      return <p>{renderInline(node.content, siteOrigin)}</p>;
    case 'heading':
      return renderHeading(node, headingAnchors, siteOrigin);
    case 'blockquote':
      return <blockquote>{renderInnerParagraphs(node.content, siteOrigin)}</blockquote>;
    case 'bullet_list':
      return <ul>{renderListItems(node.content, siteOrigin)}</ul>;
    case 'ordered_list':
      return <ol>{renderListItems(node.content, siteOrigin)}</ol>;
    case 'code_block':
      // M0 输出纯文本；className 保留 language-* 约定，M1 接 Shiki 时类名契约不变。
      return (
        <pre>
          <code
            className={
              node.attrs.language === undefined ? undefined : `language-${node.attrs.language}`
            }
          >
            {(node.content ?? []).map((t) => t.text).join('')}
          </code>
        </pre>
      );
    case 'figure': {
      const { src, alt, caption } = node.attrs;
      return (
        <figure>
          {/* 图片只放行站内来源（isAllowedImageSrc）：第三方图源是对读者/审稿人的 IP 追踪面。 */}
          {isAllowedImageSrc(src, siteOrigin) ? (
            <img src={src} alt={alt} loading="lazy" />
          ) : (
            <div className="figure-blocked">外部图片已屏蔽（M0 仅支持站内图片）：{alt}</div>
          )}
          {caption === undefined ? null : <figcaption>{caption}</figcaption>}
        </figure>
      );
    }
    case 'table':
      return renderTable(node, siteOrigin);
    case 'callout':
      return renderCallout(node, siteOrigin);
    case 'divider':
      return <hr />;
    case 'math_block':
      // M0 降级展示 LaTeX 源码（KaTeX 是 M1）；class 契约 math-block 与 ui 包对齐。
      return <pre className="math-block">{node.attrs.latex}</pre>;
    default: {
      const exhausted: never = node;
      return exhausted;
    }
  }
}

export interface ArticleRendererProps {
  /** 接收 unknown：渲染端不信任任何来源的文档 JSON，一律先过 kernel validateDoc。 */
  doc: unknown;
  headingAnchors?: boolean;
  /**
   * 本站 origin（如 'https://example.com'）；提供后指向本站的绝对 http(s) 链接不按外链处理，
   * 缺省时所有绝对 http(s) 链接按外链处理（宁可错杀 rel 属性，不可放过外链裸奔）。
   */
  siteOrigin?: string;
}

/**
 * 文档渲染入口（RSC 安全）。每个顶层块输出 <section id="b-{blockId}" data-block-type>，
 * 该锚点为行内评论、搜索深链、外部引用三方共用（架构 §7），id 格式不可变更。
 * 校验失败渲染中文错误占位而非抛错，避免单篇坏数据崩掉整页。
 */
export function ArticleRenderer({
  doc,
  headingAnchors = true,
  siteOrigin,
}: ArticleRendererProps): ReactElement {
  let validated: DocJson;
  try {
    validated = validateDoc(doc);
  } catch {
    return <div className="render-error">内容暂时无法显示：文档数据未通过校验，请稍后重试。</div>;
  }
  return (
    <>
      {validated.content.map((node) => (
        <section
          key={node.attrs.blockId}
          id={`b-${node.attrs.blockId}`}
          data-block-type={node.type}
        >
          {renderBlockContent(node, headingAnchors, siteOrigin)}
        </section>
      ))}
    </>
  );
}

export interface TocEntry {
  id: string;
  level: 2 | 3 | 4;
  text: string;
}

/** 从已校验文档提取目录；id 与 ArticleRenderer 输出的 section 锚点一致（b-{blockId}）。 */
export function extractToc(doc: DocJson): TocEntry[] {
  const toc: TocEntry[] = [];
  for (const node of doc.content) {
    if (node.type === 'heading') {
      toc.push({ id: `b-${node.attrs.blockId}`, level: node.attrs.level, text: extractText(node) });
    }
  }
  return toc;
}
