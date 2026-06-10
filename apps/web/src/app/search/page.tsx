import { searchBlocks } from '@harublog/search';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: '搜索', robots: { index: false } };

interface SearchPageProps {
  searchParams: Promise<{ q?: string }>;
}

interface DocGroup {
  docId: string;
  slug: string;
  title: string;
  sectionName: string;
  hits: { blockId: string; snippet: string }[];
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q } = await searchParams;
  const query = (q ?? '').trim();

  let groups: DocGroup[] = [];
  let total = 0;
  let failed = false;
  if (query.length > 0) {
    try {
      const result = await searchBlocks(query);
      total = result.estimatedTotal;
      const byDoc = new Map<string, DocGroup>();
      for (const hit of result.hits) {
        const g = byDoc.get(hit.docId) ?? {
          docId: hit.docId,
          slug: hit.slug,
          title: hit.title,
          sectionName: hit.sectionName,
          hits: [],
        };
        g.hits.push({ blockId: hit.blockId, snippet: hit.snippet });
        byDoc.set(hit.docId, g);
      }
      groups = [...byDoc.values()];
    } catch {
      // 搜索服务不可用：降级提示，不崩页面（Meilisearch 非真相源）
      failed = true;
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <h1 className="font-serif text-2xl font-semibold text-ink-900">搜索</h1>
      <form method="get" action="/search" className="mt-4 flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="搜索文章标题或正文段落…"
          className="h-10 flex-1 rounded-sm border border-ink-300 bg-paper-50 px-3 text-ink-900 placeholder:text-ink-400 focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
        />
        <button
          type="submit"
          className="rounded-sm bg-brand-700 px-4 font-medium text-paper-50 hover:bg-brand-800"
        >
          搜索
        </button>
      </form>

      {query.length === 0 ? (
        <p className="mt-8 text-sm text-ink-500">输入关键词，搜索结果会直达命中的段落。</p>
      ) : failed ? (
        <p className="mt-8 text-sm text-accent-700">搜索服务暂时不可用，请稍后再试。</p>
      ) : groups.length === 0 ? (
        <p className="mt-8 text-sm text-ink-500">没有找到与「{query}」相关的内容。</p>
      ) : (
        <>
          <p className="mt-6 text-sm text-ink-500">约 {total} 个相关段落</p>
          <ul className="mt-4 flex flex-col gap-6">
            {groups.map((g) => (
              <li key={g.docId} className="border-b border-ink-100 pb-6">
                <p className="text-xs text-ink-400">{g.sectionName}</p>
                <Link
                  href={`/a/${g.slug}`}
                  className="font-serif text-lg font-semibold text-ink-900 hover:text-brand-700"
                >
                  {g.title}
                </Link>
                <ul className="mt-2 flex flex-col gap-2">
                  {g.hits.map((h) => (
                    <li key={h.blockId}>
                      <Link
                        href={`/a/${g.slug}#b-${h.blockId}`}
                        className="block rounded-sm px-3 py-2 text-sm leading-relaxed text-ink-600 hover:bg-paper-200"
                      >
                        {/* 高亮片段来自 Meilisearch，仅含受控 <mark> 包裹（无用户可注入的 HTML） */}
                        <SearchSnippet html={h.snippet} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * 搜索高亮片段渲染：Meilisearch 返回的 _formatted 文本只含我们配置的 <mark> 标签，
 * 其余字符已由 Meilisearch HTML 转义。为安全起见，自行按 <mark>…</mark> 切分后用
 * React 元素重建，绝不 dangerouslySetInnerHTML（UGC XSS 红线，与 renderer 同纪律）。
 */
function SearchSnippet({ html }: { html: string }) {
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
        <mark key={i} className="bg-brand-100 text-ink-900">
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
