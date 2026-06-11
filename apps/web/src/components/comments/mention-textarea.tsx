'use client';

// 带 @提及自动补全的文本域：打 @ + 字符时弹出用户候选，↑↓ 选择、Enter/Tab 确认、Esc 关闭。
// 受控组件（value/onChange 同 <textarea>）。候选来自 /api/users/search（仅含已设用户名的用户）。
import { useCallback, useEffect, useRef, useState } from 'react';

interface Candidate {
  username: string;
  name: string;
  image: string | null;
}

// 光标前「正在输入的 @token」：@ 前是行首或空白，token 体为 0–20 位用户名字符
const TOKEN_RE = /(^|\s)@([a-zA-Z0-9_]{0,20})$/;

export interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}

export function MentionTextarea({
  value,
  onChange,
  placeholder,
  rows = 3,
  disabled,
}: MentionTextareaProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [items, setItems] = useState<Candidate[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const tokenStartRef = useRef<number>(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setItems([]);
    tokenStartRef.current = -1;
  }, []);

  // 根据光标位置探测 @token；命中则发起（防抖）查询，否则收起菜单
  const detect = useCallback(() => {
    const el = ref.current;
    if (el === null) {
      return;
    }
    const cursor = el.selectionStart ?? 0;
    const before = value.slice(0, cursor);
    const m = before.match(TOKEN_RE);
    if (m === null) {
      closeMenu();
      return;
    }
    const query = m[2] ?? '';
    tokenStartRef.current = cursor - query.length - 1; // 指向 '@'
    if (query.length === 0) {
      closeMenu();
      return;
    }
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
        const data = (await res.json()) as { users: Candidate[] };
        setItems(data.users);
        setActive(0);
        setOpen(data.users.length > 0);
      } catch {
        closeMenu();
      }
    }, 150);
  }, [value, closeMenu]);

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  function choose(c: Candidate) {
    const el = ref.current;
    const start = tokenStartRef.current;
    if (el === null || start < 0) {
      return;
    }
    const cursor = el.selectionStart ?? value.length;
    const next = `${value.slice(0, start)}@${c.username} ${value.slice(cursor)}`;
    onChange(next);
    closeMenu();
    // 把光标移到插入内容之后
    const pos = start + c.username.length + 2;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!open || items.length === 0) {
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const c = items[active];
      if (c !== undefined) {
        choose(c);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
    }
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        rows={rows}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          detect();
        }}
        onKeyUp={detect}
        onClick={detect}
        onBlur={() => setTimeout(closeMenu, 120)}
        onKeyDown={onKeyDown}
        className="min-h-20 w-full rounded-sm border border-ink-200 bg-paper-50 px-3 py-2 text-ink-900 text-sm leading-relaxed placeholder:text-ink-400 focus-visible:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-200 disabled:cursor-not-allowed disabled:bg-paper-200 disabled:opacity-70"
      />
      {open ? (
        <ul className="absolute z-30 mt-1 max-h-60 w-64 overflow-auto rounded-sm border border-ink-200 bg-paper-50 py-1 shadow-lg">
          {items.map((c, i) => (
            <li key={c.username}>
              <button
                type="button"
                // onMouseDown 早于 textarea 的 onBlur，避免菜单先被关掉
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(c);
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                  i === active ? 'bg-brand-50 text-brand-800' : 'text-ink-700 hover:bg-paper-200'
                }`}
              >
                <span className="font-medium">@{c.username}</span>
                <span className="truncate text-ink-400 text-xs">{c.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
