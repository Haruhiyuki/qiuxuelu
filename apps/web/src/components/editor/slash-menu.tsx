'use client';

// 斜杠命令菜单的展示层（定位与键盘导航由 slash-command 渲染器驱动）。
import { cn } from '@harublog/ui';
import type { SlashItem } from './slash-types';

export function SlashMenu({
  items,
  selectedIndex,
  onSelect,
}: {
  items: SlashItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="w-56 rounded-sm border border-ink-200 bg-paper-50 px-3 py-2 text-ink-400 text-sm shadow-lg">
        无匹配命令
      </div>
    );
  }
  return (
    <div className="pop-in max-h-72 w-56 overflow-y-auto rounded-sm border border-ink-200 bg-paper-50 py-1 shadow-lg">
      {items.map((item, i) => (
        <button
          key={item.title}
          type="button"
          // mousedown + preventDefault：避免编辑器先失焦导致 range 失效
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(i);
          }}
          className={cn(
            'flex w-full flex-col items-start px-3 py-1.5 text-left',
            i === selectedIndex ? 'bg-brand-100' : 'hover:bg-paper-200',
          )}
        >
          <span className="text-ink-800 text-sm">{item.title}</span>
          <span className="text-ink-400 text-xs">{item.hint}</span>
        </button>
      ))}
    </div>
  );
}
