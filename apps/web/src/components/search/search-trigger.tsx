'use client';

// 页头搜索入口：外观仿输入框，点击（或 ⌘K）打开命令面板。不再整页跳转 /search，速搜即点即用。
import { Search } from 'lucide-react';

function openSearch() {
  window.dispatchEvent(new CustomEvent('harublog:open-search'));
}

/** 桌面页头（md+）的搜索触发钮。 */
export function SearchTrigger() {
  return (
    <button
      type="button"
      onClick={openSearch}
      aria-label="搜索"
      aria-keyshortcuts="Control+K Meta+K"
      className="group relative hidden h-8 w-44 items-center rounded-full border border-ink-200 bg-paper-50 pr-2 pl-8 text-left transition-colors hover:border-brand-300 focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200 md:flex lg:w-52"
    >
      <Search
        aria-hidden
        className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 text-ink-400"
      />
      <span className="flex-1 truncate text-ink-400 text-sm">搜索博客…</span>
      <kbd className="hidden shrink-0 rounded border border-ink-200 px-1.5 py-px font-sans text-[11px] text-ink-400 lg:inline">
        ⌘K
      </kbd>
    </button>
  );
}
