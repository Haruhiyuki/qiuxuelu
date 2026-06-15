import type { ReactNode } from 'react';

/**
 * 搜索高亮片段渲染：Meilisearch 返回的 _formatted 文本只含我们配置的 <mark> 标签，
 * 其余字符已由 Meilisearch HTML 转义。为安全起见，自行按 <mark>…</mark> 切分后用
 * React 元素重建，绝不 dangerouslySetInnerHTML（UGC XSS 红线，与 renderer 同纪律）。
 * 无 hooks 的纯组件——服务端结果页与客户端速搜面板共用。
 */
export function SearchSnippet({ html }: { html: string }) {
  const parts = html.split(/(<mark>|<\/mark>)/);
  let marking = false;
  const nodes: ReactNode[] = [];
  let i = 0;
  for (const part of parts) {
    if (part === '<mark>') {
      marking = true;
      continue;
    }
    if (part === '</mark>') {
      marking = false;
      continue;
    }
    if (part.length === 0) {
      continue;
    }
    // Meilisearch 已转义实体；这里再解码常见实体回可读字符（纯文本，不引入标签）
    const text = part
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('&amp;', '&');
    nodes.push(
      marking ? (
        <mark key={i} className="rounded-[2px] bg-brand-100 px-0.5 font-medium text-brand-900">
          {text}
        </mark>
      ) : (
        <span key={i}>{text}</span>
      ),
    );
    i++;
  }
  return <>…{nodes}…</>;
}
