'use client';

// ⌘K 速搜命令面板（成熟产品式：Algolia DocSearch / Linear / Notion 那种）。
// 全局挂载一次（随站点页头一起），监听 ⌘K/Ctrl+K、「/」以及自定义事件 harublog:open-search 打开。
// 防抖调用 quickSearch（服务端 Server Action），结果每篇一条（已去重），命中直达最佳段落。
// 列表首项恒为「查看全部结果」：回车默认进详细结果页，↑↓ 选具体文章、esc 关闭。
import { Clock, CornerDownLeft, FileText, Loader2, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type QuickSearchResult, quickSearch } from '@/server/actions/search';
import { SearchSnippet } from './search-snippet';

const RECENT_KEY = 'harublog:recent-search';
const MAX_RECENT = 6;
const DEBOUNCE_MS = 200;

/** 焦点是否在可输入控件内（决定「/」是否拦截为打开速搜）。 */
function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) {
    return false;
  }
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable;
}

export function SearchCommand() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QuickSearchResult | null>(null);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setResult(null);
    setActive(0);
  }, []);

  // 全局打开入口：⌘K/Ctrl+K 切换、「/」打开（非输入态）、自定义事件（页头/移动端触发）
  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === '/' && !isTypingTarget(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('harublog:open-search', onOpen);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('harublog:open-search', onOpen);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // 打开时：读最近搜索、聚焦输入框、锁背景滚动
  useEffect(() => {
    if (!open) {
      return;
    }
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      setRecent(raw !== null ? (JSON.parse(raw) as string[]) : []);
    } catch {
      setRecent([]);
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    return () => {
      document.body.style.overflow = prev;
      clearTimeout(t);
    };
  }, [open]);

  // 防抖搜索：仅采纳最新一次请求结果（seq 去竞态）
  useEffect(() => {
    if (!open) {
      return;
    }
    const q = query.trim();
    if (q.length === 0) {
      setResult(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = ++seqRef.current;
    const t = setTimeout(() => {
      quickSearch(q)
        .then((r) => {
          if (seqRef.current === id) {
            setResult(r);
            setActive(0);
          }
        })
        .catch(() => {
          if (seqRef.current === id) {
            setResult({ groups: [], total: 0, failed: true });
          }
        })
        .finally(() => {
          if (seqRef.current === id) {
            setLoading(false);
          }
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, open]);

  const q = query.trim();
  const hasQuery = q.length > 0;

  // 命中文章：去重后每篇一条，取最佳命中块
  const articles = useMemo(() => {
    if (result === null || result.failed) {
      return [];
    }
    return result.groups.flatMap((g) => {
      const best = g.hits[0];
      return best === undefined
        ? []
        : [
            {
              slug: g.slug,
              title: g.title,
              sectionName: g.sectionName,
              authorName: g.authorName,
              blockId: best.blockId,
              snippet: best.snippet,
            },
          ];
    });
  }, [result]);

  // 可选中项：第 0 项恒为「查看全部结果」（回车默认进结果页），其后为各篇文章
  const items = useMemo(() => {
    if (!hasQuery) {
      return [] as string[];
    }
    return [
      `/search?q=${encodeURIComponent(q)}`,
      ...articles.map((a) => `/a/${a.slug}#b-${a.blockId}`),
    ];
  }, [hasQuery, q, articles]);

  const go = useCallback(
    (href: string) => {
      if (q.length > 0) {
        try {
          const next = [q, ...recent.filter((r) => r !== q)].slice(0, MAX_RECENT);
          localStorage.setItem(RECENT_KEY, JSON.stringify(next));
        } catch {
          // localStorage 不可用：忽略，不影响跳转
        }
      }
      close();
      router.push(href);
    },
    [q, recent, router, close],
  );

  // 选中项滚动进视野
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(0, items.length - 1)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // 默认（active=0）→ 全部结果页；选中具体文章 → 打开该文
      const href = items[active] ?? items[0];
      if (href !== undefined) {
        go(href);
      }
    }
  };

  if (!mounted || !open) {
    return null;
  }

  const showRecent = q.length === 0;
  const showEmpty =
    q.length > 0 && !loading && result !== null && !result.failed && result.groups.length === 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center p-4 sm:pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="搜索"
    >
      <button
        type="button"
        aria-label="关闭搜索"
        onClick={close}
        className="overlay-in absolute inset-0 bg-ink-900/40 backdrop-blur-sm"
      />
      <div className="pop-in relative flex max-h-[78vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-ink-200 bg-paper-50 shadow-float">
        {/* 输入行 */}
        <div className="flex items-center gap-3 border-ink-200/70 border-b px-4">
          <Search className="h-5 w-5 shrink-0 text-ink-400" aria-hidden />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索文章标题或段落…"
            aria-label="搜索关键词"
            autoComplete="off"
            className="h-14 min-w-0 flex-1 bg-transparent text-base text-ink-900 outline-none placeholder:text-ink-400"
          />
          {loading ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ink-400" aria-hidden />
          ) : (
            <kbd className="hidden shrink-0 rounded border border-ink-200 px-1.5 py-0.5 font-sans text-[11px] text-ink-400 sm:inline">
              esc
            </kbd>
          )}
        </div>

        {/* 结果区 */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          {showRecent ? (
            recent.length > 0 ? (
              <>
                <p className="px-2 pt-1 pb-1.5 font-medium text-ink-400 text-xs">最近搜索</p>
                <ul>
                  {recent.map((term) => (
                    <li key={term}>
                      <button
                        type="button"
                        onClick={() => {
                          setQuery(term);
                          inputRef.current?.focus();
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-ink-600 text-sm transition-colors hover:bg-paper-200"
                      >
                        <Clock className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
                        <span className="truncate">{term}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
                <Search className="h-8 w-8 text-ink-300" aria-hidden />
                <p className="mt-1 text-ink-500 text-sm">输入关键词开始搜索</p>
              </div>
            )
          ) : null}

          {result?.failed === true ? (
            <p className="px-3 py-10 text-center text-accent-700 text-sm">
              搜索服务暂时不可用，请稍后再试。
            </p>
          ) : null}

          {showEmpty ? (
            <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
              <p className="font-medium font-serif text-ink-700 text-sm">
                没有找到与「{q}」相关的内容
              </p>
              <p className="text-ink-400 text-xs">换个关键词，或更宽泛的说法再试试</p>
            </div>
          ) : null}

          {hasQuery && result !== null && !result.failed && articles.length > 0 ? (
            <ul className="flex flex-col gap-0.5 py-1">
              {/* 首项：查看全部结果（回车默认到此） */}
              <li>
                <button
                  type="button"
                  data-idx={0}
                  onMouseMove={() => setActive(0)}
                  onClick={() => go(`/search?q=${encodeURIComponent(q)}`)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors ${
                    active === 0 ? 'bg-brand-50' : ''
                  }`}
                >
                  <Search className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                  <span className="flex-1 font-medium text-brand-700 text-sm">
                    查看「{q}」的全部结果
                  </span>
                  {result.total > 0 ? (
                    <span className="shrink-0 text-ink-400 text-xs">{result.total} 篇</span>
                  ) : null}
                  <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-ink-400" aria-hidden />
                </button>
              </li>
              {/* 命中文章（每篇一条） */}
              {articles.map((a, i) => {
                const idx = i + 1;
                return (
                  <li key={a.slug}>
                    <button
                      type="button"
                      data-idx={idx}
                      onMouseMove={() => setActive(idx)}
                      onClick={() => go(`/a/${a.slug}#b-${a.blockId}`)}
                      className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                        active === idx ? 'bg-brand-50' : ''
                      }`}
                    >
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink-800 text-sm">
                          {a.title}
                        </span>
                        <span className="mt-0.5 block truncate text-ink-500 text-xs leading-relaxed">
                          <SearchSnippet html={a.snippet} />
                        </span>
                        <span className="mt-0.5 block truncate text-ink-400 text-xs">
                          {a.sectionName}
                          {a.authorName.length > 0 ? ` · ${a.authorName}` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        {/* 底部按键提示（窄屏隐藏） */}
        <div className="hidden items-center gap-4 border-ink-200/70 border-t px-4 py-2 text-ink-400 text-xs sm:flex">
          <KeyHint k="↑↓" label="选择" />
          <KeyHint k="↵" label="打开" />
          <KeyHint k="esc" label="关闭" />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function KeyHint({ k, label }: { k: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="rounded border border-ink-200 bg-paper-100 px-1.5 py-0.5 font-sans text-[11px]">
        {k}
      </kbd>
      {label}
    </span>
  );
}
