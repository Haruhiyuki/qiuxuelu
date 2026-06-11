// 服务端代码高亮（Shiki）：预计算 token 交给渲染器渲成 React span（不碰 innerHTML，阅读端零额外 JS）。
// 用纯 JS 正则引擎（不依赖 WASM），规避 standalone 打包问题；固定 github-dark 主题（代码块底色明暗一致）。
import type { DocJson } from '@harublog/kernel';
import { type CodeHighlights, codeHighlightKey, type HighlightToken } from '@harublog/renderer';
import { unstable_cache } from 'next/cache';
import { type BundledLanguage, createHighlighter, type Highlighter } from 'shiki';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

const THEME = 'github-dark';
const LANGS = [
  'javascript',
  'typescript',
  'tsx',
  'jsx',
  'python',
  'java',
  'c',
  'cpp',
  'csharp',
  'go',
  'rust',
  'bash',
  'shell',
  'json',
  'yaml',
  'toml',
  'sql',
  'html',
  'css',
  'markdown',
  'php',
  'ruby',
  'kotlin',
  'swift',
  'diff',
  'plaintext',
];
const SUPPORTED = new Set(LANGS);

let hlPromise: Promise<Highlighter> | null = null;
function getHighlighter(): Promise<Highlighter> {
  hlPromise ??= createHighlighter({
    themes: [THEME],
    langs: LANGS,
    engine: createJavaScriptRegexEngine(),
  });
  return hlPromise;
}

function collectCodeBlocks(doc: DocJson): { language: string | undefined; code: string }[] {
  const out: { language: string | undefined; code: string }[] = [];
  for (const node of doc.content) {
    if (node.type === 'code_block') {
      out.push({
        language: node.attrs.language,
        code: (node.content ?? []).map((t) => t.text).join(''),
      });
    }
  }
  return out;
}

/** 计算文档所有代码块的高亮（可序列化的 [key, lines] 数组，便于缓存）。 */
async function computeHighlights(doc: DocJson): Promise<[string, HighlightToken[][]][]> {
  const blocks = collectCodeBlocks(doc);
  if (blocks.length === 0) {
    return [];
  }
  const hl = await getHighlighter();
  const entries: [string, HighlightToken[][]][] = [];
  for (const { language, code } of blocks) {
    const lang = language !== undefined && SUPPORTED.has(language) ? language : 'plaintext';
    try {
      // lang 来自 LANGS 白名单且高亮器已加载，运行时合法；类型上转成 BundledLanguage 满足签名
      const { tokens } = hl.codeToTokens(code, { lang: lang as BundledLanguage, theme: THEME });
      const lines: HighlightToken[][] = tokens.map((line) =>
        line.map((t) => ({ content: t.content, color: t.color })),
      );
      entries.push([codeHighlightKey(language, code), lines]);
    } catch {
      // 该块高亮失败：跳过，渲染器自动降级为纯文本
    }
  }
  return entries;
}

/**
 * 为文档的代码块产出高亮 Map。传 cacheKey（如 revisionId）时按其缓存——
 * 内容不可变 → 高亮永久可缓存，省去每次请求重跑 Shiki。无代码块零开销。
 */
export async function highlightDoc(doc: DocJson, cacheKey?: string): Promise<CodeHighlights> {
  const entries =
    cacheKey === undefined
      ? await computeHighlights(doc)
      : await unstable_cache(() => computeHighlights(doc), ['shiki-highlight', cacheKey], {
          tags: [`revision:${cacheKey}`],
        })();
  return new Map(entries);
}
