'use client';

// 行内批注岛（阅读端唯一的客户端交互）：
// 撰写：选中段落文字 → 浮现「批注」入口（桌面=选区上方胶囊；触屏=底部固定按钮，避开原生选区菜单）
//   → 编辑（桌面=右侧批注侧栏顶部草稿卡；触屏=顶部浮层 + 遮罩，避开键盘）；编辑时所选文字按批注样式高亮。
// 阅读（桌面 xl+）：右侧 Word 式批注侧栏——卡片列表、整栏可滚动；点正文高亮 → 该段卡片置顶高亮并滚入。
//   作者注始终置顶，其次是被点击聚焦的段落，其余按文档顺序。
// 阅读（窄屏）：点正文高亮 → 浮窗展示该段批注。
// 锚点偏移以段落 DOM 的 textContent 为口径（= kernel extractText）。
import { Button } from '@harublog/ui';
import { MessageSquarePlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createInlineComment } from '@/server/actions/comment';
import { MentionText } from './mention-text';
import { MentionTextarea } from './mention-textarea';

export interface InlineCommentView {
  id: string;
  blockId: string;
  quotedText: string;
  startOffset: number;
  endOffset: number;
  text: string;
  authorName: string;
  state: 'live' | 'remapped' | 'orphaned';
  createdAtLabel: string;
  /** 作者注：作者本人对自己文章的行内批注，置顶展示并标注 */
  isAuthorNote: boolean;
}

interface PendingAnchor {
  blockId: string;
  startOffset: number;
  endOffset: number;
  quotedText: string;
  prefix: string;
  suffix: string;
  x: number;
  y: number;
}

interface AnchorGroup {
  blockId: string;
  items: InlineCommentView[];
}

const CTX = 16;

export function InlineComments({
  docId,
  canComment,
  comments,
}: {
  docId: string;
  canComment: boolean;
  /** 仅未失锚的批注（失锚的由页面在文末单独折叠展示） */
  comments: InlineCommentView[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingAnchor | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // 窄屏点击 mark 弹出的批注浮窗
  const [popover, setPopover] = useState<{ blockId: string; x: number; y: number } | null>(null);
  // 桌面侧栏中被点击聚焦的段落（置顶 + 高亮 + 滚入）
  const [focusedBlock, setFocusedBlock] = useState<string | null>(null);
  // 正文 mark 悬停 → 对应侧栏卡提亮
  const [activeBlock, setActiveBlock] = useState<string | null>(null);
  // 是否宽屏（xl+，存在右侧批注侧栏）：决定编辑/阅读落在侧栏还是浮层
  const [isWide, setIsWide] = useState(false);
  // 是否触屏（粗指针）：触屏选字会弹原生菜单，故「批注」入口改为底部固定按钮
  const [isTouch, setIsTouch] = useState(false);

  const popoverRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());

  const cancelDraft = useCallback(() => {
    setOpen(false);
    setPending(null);
    setText('');
    setError(null);
    setNotice(null);
  }, []);

  // 按锚点段落分组（同段多条批注合入一张卡）
  const groups = useMemo<AnchorGroup[]>(() => {
    const byBlock = new Map<string, InlineCommentView[]>();
    for (const c of comments) {
      if (c.state === 'orphaned') {
        continue;
      }
      const list = byBlock.get(c.blockId) ?? [];
      list.push(c);
      byBlock.set(c.blockId, list);
    }
    return [...byBlock.entries()].map(([blockId, items]) => ({ blockId, items }));
  }, [comments]);

  const totalCount = useMemo(() => groups.reduce((n, g) => n + g.items.length, 0), [groups]);

  // 侧栏排序：作者注组优先，其次被点击聚焦的组，其余保持文档顺序（sort 稳定）
  const sortedGroups = useMemo(() => {
    const hasAuthor = (g: AnchorGroup) => g.items.some((i) => i.isAuthorNote);
    return [...groups].sort((a, b) => {
      const au = Number(hasAuthor(b)) - Number(hasAuthor(a));
      if (au !== 0) {
        return au;
      }
      return Number(b.blockId === focusedBlock) - Number(a.blockId === focusedBlock);
    });
  }, [groups, focusedBlock]);

  const captureSelection = useCallback(() => {
    if (!canComment || open) {
      return;
    }
    const sel = window.getSelection();
    if (sel === null || sel.isCollapsed || sel.rangeCount === 0) {
      setPending(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const quoted = sel.toString().trim();
    if (quoted.length === 0) {
      setPending(null);
      return;
    }
    // 选区两端必须落在同一个 data-block-type="paragraph" 的块内
    const block = closestParagraph(range.commonAncestorContainer);
    if (block === null) {
      setPending(null);
      return;
    }
    const blockId = block.id.startsWith('b-') ? block.id.slice(2) : '';
    if (blockId === '') {
      setPending(null);
      return;
    }
    const blockText = block.textContent ?? '';
    const pre = range.cloneRange();
    pre.selectNodeContents(block);
    pre.setEnd(range.startContainer, range.startOffset);
    const startOffset = pre.toString().length;
    const selectedText = sel.toString();
    const endOffset = startOffset + selectedText.length;
    const rect = range.getBoundingClientRect();
    setPending({
      blockId,
      startOffset,
      endOffset,
      quotedText: selectedText.trim(),
      prefix: blockText.slice(Math.max(0, startOffset - CTX), startOffset),
      suffix: blockText.slice(endOffset, endOffset + CTX),
      // fixed 定位用视口坐标，规避「定位祖先」问题；水平向钳制在视口内
      x: clampX(rect.left + rect.width / 2, 176),
      y: rect.top,
    });
  }, [canComment, open]);

  useEffect(() => {
    document.addEventListener('mouseup', captureSelection);
    return () => document.removeEventListener('mouseup', captureSelection);
  }, [captureSelection]);

  // 触屏没有 mouseup：监听 selectionchange（防抖），等选区稳定后再浮现「批注」入口
  useEffect(() => {
    if (!canComment) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onSelChange = () => {
      if (open) {
        return;
      }
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(captureSelection, 400);
    };
    document.addEventListener('selectionchange', onSelChange);
    return () => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      document.removeEventListener('selectionchange', onSelChange);
    };
  }, [canComment, open, captureSelection]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1280px)');
    const update = () => setIsWide(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    const update = () => setIsTouch(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // 编辑中：把待批注的文字按批注样式高亮（is-draft，与已存批注同一视觉语言），取消/提交后还原
  useEffect(() => {
    if (!open || pending === null) {
      return;
    }
    const block = document.getElementById(`b-${pending.blockId}`);
    if (block === null) {
      return;
    }
    const marks = highlightQuote(block, pending.quotedText, pending.startOffset, '__draft__');
    for (const m of marks) {
      m.classList.add('is-draft');
    }
    return () => {
      for (const m of marks) {
        unwrapMark(m);
      }
    };
  }, [open, pending]);

  // 边注卡 ↔ 正文 mark 互相提亮（直接切 class，不经 React 状态以免重排）
  const setMarksActive = useCallback((blockId: string, on: boolean) => {
    for (const mark of document.querySelectorAll<HTMLElement>(
      `mark.comment-mark[data-block-id="${blockId}"]`,
    )) {
      mark.classList.toggle('is-active', on);
    }
  }, []);

  // 正文内高亮：把每条批注的字符区间在对应段落里包成 <mark>。
  // 点击：桌面（侧栏可见）→ 聚焦该段卡片（置顶+滚入）；窄屏 → 弹出批注浮窗。悬停与卡片互相提亮。
  useEffect(() => {
    const onMarkClick = (e: Event) => {
      const el = e.currentTarget as HTMLElement;
      const blockId = el.dataset.blockId;
      if (blockId === undefined) {
        return;
      }
      if (isWide) {
        setFocusedBlock(blockId);
        return;
      }
      const rect = el.getBoundingClientRect();
      setPopover({ blockId, x: clampX(rect.left + rect.width / 2, 168), y: rect.bottom + 8 });
    };
    const onMarkEnter = (e: Event) => {
      setActiveBlock((e.currentTarget as HTMLElement).dataset.blockId ?? null);
    };
    const onMarkLeave = () => setActiveBlock(null);

    const created: HTMLElement[] = [];
    for (const c of comments) {
      if (c.state === 'orphaned' || c.quotedText.length === 0) {
        continue;
      }
      const block = document.getElementById(`b-${c.blockId}`);
      if (block === null) {
        continue;
      }
      for (const mark of highlightQuote(block, c.quotedText, c.startOffset, c.id)) {
        mark.dataset.blockId = c.blockId;
        mark.addEventListener('click', onMarkClick);
        mark.addEventListener('mouseenter', onMarkEnter);
        mark.addEventListener('mouseleave', onMarkLeave);
        created.push(mark);
      }
    }
    return () => {
      for (const mark of created) {
        mark.removeEventListener('click', onMarkClick);
        mark.removeEventListener('mouseenter', onMarkEnter);
        mark.removeEventListener('mouseleave', onMarkLeave);
        unwrapMark(mark);
      }
    };
  }, [comments, isWide]);

  // 聚焦段落（点正文高亮）→ 侧栏卡片滚入 + 闪烁 + 正文高亮提亮
  useEffect(() => {
    if (focusedBlock === null || !isWide) {
      return;
    }
    const card = cardRefs.current.get(focusedBlock);
    if (card !== undefined) {
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      flash(card);
    }
    setMarksActive(focusedBlock, true);
    return () => setMarksActive(focusedBlock, false);
  }, [focusedBlock, isWide, setMarksActive]);

  // 浮窗打开期间，持续提亮其对应正文高亮
  useEffect(() => {
    if (popover === null) {
      return;
    }
    setMarksActive(popover.blockId, true);
    return () => setMarksActive(popover.blockId, false);
  }, [popover, setMarksActive]);

  // 浮窗：点外部或 Esc 关闭
  useEffect(() => {
    if (popover === null) {
      return;
    }
    const onPointerDown = (e: PointerEvent) => {
      if (popoverRef.current !== null && !popoverRef.current.contains(e.target as Node)) {
        setPopover(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPopover(null);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [popover]);

  async function submit() {
    if (pending === null || text.trim().length === 0) {
      return;
    }
    setBusy(true);
    setError(null);
    const result = await createInlineComment(
      docId,
      {
        blockId: pending.blockId,
        startOffset: pending.startOffset,
        endOffset: pending.endOffset,
        quotedText: pending.quotedText,
        prefix: pending.prefix.length > 0 ? pending.prefix : undefined,
        suffix: pending.suffix.length > 0 ? pending.suffix : undefined,
      },
      text,
    );
    if (result.ok) {
      setText('');
      if (result.data.held) {
        // AI 审核拦下：批注已存但暂不公开，等管理员复核放行
        setError(null);
        setNotice('批注已提交，正在审核，通过后会显示。');
      } else {
        const bId = pending.blockId;
        setOpen(false);
        setPending(null);
        setNotice(null);
        setFocusedBlock(bId); // 新批注所在段落置顶
        router.refresh();
      }
    } else {
      setError(result.error);
    }
    setBusy(false);
  }

  const popoverGroup =
    popover !== null ? (groups.find((g) => g.blockId === popover.blockId) ?? null) : null;

  return (
    <>
      {/* 触屏：底部固定按钮，避开 iOS/安卓选字时贴着选区浮现的原生菜单 */}
      {pending !== null && !open && isTouch ? (
        <div className="fixed inset-x-0 bottom-6 z-30 flex justify-center px-4">
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              window.getSelection()?.removeAllRanges();
              setOpen(true);
            }}
            className="pop-in inline-flex items-center gap-2 rounded-full bg-fill px-5 py-2.5 font-medium text-on-fill text-sm shadow-float transition-colors hover:bg-fill-hover"
          >
            <MessageSquarePlus className="h-4 w-4" aria-hidden />
            批注选中文字
          </button>
        </div>
      ) : null}

      {/* 桌面（无原生菜单）：胶囊锚定在选区上方 */}
      {pending !== null && !open && !isTouch ? (
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            // 收起浏览器蓝色选区，让批注样式高亮接管
            window.getSelection()?.removeAllRanges();
            setOpen(true);
          }}
          style={{ left: pending.x, top: pending.y - 44 }}
          className="pop-in -translate-x-1/2 fixed z-30 inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-paper-50 px-3 py-1.5 font-medium text-ink-700 text-xs shadow-float transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
          批注
        </button>
      ) : null}

      {/* 窄屏（无侧栏）：编辑框为顶部居中浮层 + 遮罩，固定顶部避开键盘 */}
      {pending !== null && open && !isWide ? (
        <div className="fixed inset-0 z-40">
          <button
            type="button"
            aria-label="取消批注"
            onClick={cancelDraft}
            className="overlay-in absolute inset-0 bg-ink-900/30 backdrop-blur-[1px]"
          />
          <div className="pop-in -translate-x-1/2 absolute top-3 left-1/2 w-[calc(100vw-1.5rem)] max-w-md rounded-lg border border-ink-200 bg-paper-50 p-4 shadow-float">
            <DraftEditor
              quotedText={pending.quotedText}
              text={text}
              onText={setText}
              busy={busy}
              error={error}
              notice={notice}
              onSubmit={submit}
              onCancel={cancelDraft}
            />
          </div>
        </div>
      ) : null}

      {/* 窄屏批注浮窗：锚定在被点击的 mark 下方 */}
      {popover !== null && popoverGroup !== null ? (
        <div
          ref={popoverRef}
          style={{ left: popover.x, top: popover.y }}
          className="fade-in -translate-x-1/2 fixed z-30 flex max-h-[60vh] w-[21rem] max-w-[calc(100vw-2rem)] flex-col rounded-md border border-ink-200 bg-paper-50 shadow-float"
          role="dialog"
          aria-label="本段批注"
        >
          <div className="flex items-center justify-between border-ink-200/70 border-b px-4 py-2.5">
            <p className="font-medium text-ink-800 text-sm">
              本段批注（{popoverGroup.items.length}）
            </p>
            <button
              type="button"
              onClick={() => setPopover(null)}
              aria-label="关闭"
              className="text-ink-400 text-sm hover:text-ink-700"
            >
              ✕
            </button>
          </div>
          <div className="overflow-y-auto p-4">
            <CommentList items={popoverGroup.items} onLocate={scrollToMark} />
          </div>
        </div>
      ) : null}

      {/* 桌面批注侧栏（文章页网格第三栏，280px）：Word 式卡片列表，整栏吸顶可滚动 */}
      <aside aria-label="行内批注" className="hidden xl:block">
        <div className="sticky top-24 flex max-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-lg border border-ink-200 bg-paper-50/70 shadow-paper">
          <header className="flex items-center justify-between border-ink-200/70 border-b px-3.5 py-2.5">
            <span className="font-medium font-serif text-ink-700 text-sm">批注</span>
            {totalCount > 0 ? (
              <span className="text-ink-400 text-xs tabular-nums">{totalCount}</span>
            ) : null}
          </header>
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
            {/* 草稿编辑卡：置于侧栏顶部（正在编辑的那条展开，其余为卡片） */}
            {pending !== null && open ? (
              <div className="pop-in rounded-md border border-ochre-600/60 bg-paper-50 p-3 shadow-paper ring-1 ring-ochre-600/15">
                <DraftEditor
                  quotedText={pending.quotedText}
                  text={text}
                  onText={setText}
                  busy={busy}
                  error={error}
                  notice={notice}
                  onSubmit={submit}
                  onCancel={cancelDraft}
                />
              </div>
            ) : null}
            {groups.length === 0 && !open ? (
              <p className="px-1 py-6 text-center text-ink-400 text-xs leading-relaxed">
                {canComment ? '选中正文中的一段文字，即可在此留下批注。' : '还没有批注。'}
              </p>
            ) : null}
            {sortedGroups.map((g) => {
              const active = focusedBlock === g.blockId || activeBlock === g.blockId;
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: 悬停联动是纯装饰增强；定位由卡内引文按钮承担
                <div
                  key={g.blockId}
                  ref={(el) => {
                    if (el === null) {
                      cardRefs.current.delete(g.blockId);
                    } else {
                      cardRefs.current.set(g.blockId, el);
                    }
                  }}
                  onMouseEnter={() => setMarksActive(g.blockId, true)}
                  onMouseLeave={() => setMarksActive(g.blockId, false)}
                  className={`scroll-mt-3 rounded-md border p-3 transition-colors ${
                    active
                      ? 'border-ochre-600/60 bg-ochre-50/40'
                      : 'border-ink-200 bg-paper-50 hover:border-ink-300'
                  }`}
                >
                  <CommentList items={g.items} compact onLocate={scrollToMark} />
                </div>
              );
            })}
          </div>
        </div>
      </aside>
    </>
  );
}

/** 批注编辑框（侧栏草稿卡与窄屏浮层共用）：引文小注 + @提及文本域 + 提交/取消。 */
function DraftEditor({
  quotedText,
  text,
  onText,
  busy,
  error,
  notice,
  onSubmit,
  onCancel,
}: {
  quotedText: string;
  text: string;
  onText: (v: string) => void;
  busy: boolean;
  error: string | null;
  notice: string | null;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <p className="line-clamp-2 border-ochre-600 border-l-2 pl-2 text-ink-500 text-xs italic leading-relaxed">
        「{quotedText}」
      </p>
      <MentionTextarea
        value={text}
        onChange={onText}
        rows={3}
        placeholder="写下针对这段文字的批注…（用 @ 提及他人）"
        disabled={busy}
        autoFocus
      />
      {error !== null ? <p className="text-accent-700 text-xs">{error}</p> : null}
      {notice !== null ? <p className="text-moss-700 text-xs">{notice}</p> : null}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md px-2.5 py-1 text-ink-500 text-sm transition-colors hover:bg-paper-200 hover:text-ink-700 disabled:opacity-50"
        >
          取消
        </button>
        <Button
          type="button"
          size="sm"
          onClick={onSubmit}
          disabled={busy || text.trim().length === 0}
        >
          {busy ? '提交中…' : '提交批注'}
        </Button>
      </div>
    </div>
  );
}

/** 批注列表（侧栏卡与浮窗共用）：引文小注 + 正文 + 署名。作者注置顶。 */
function CommentList({
  items,
  compact = false,
  onLocate,
}: {
  items: InlineCommentView[];
  compact?: boolean;
  onLocate?: (c: InlineCommentView) => void;
}) {
  // 作者注置顶（同一段内排在其它批注之上），其余保持原有时间顺序
  const ordered = [...items].sort((a, b) => Number(b.isAuthorNote) - Number(a.isAuthorNote));
  return (
    <ul className={`flex flex-col ${compact ? 'gap-3' : 'gap-4'}`}>
      {ordered.map((c) => (
        <li key={c.id} className="group/item">
          {c.isAuthorNote ? (
            <span className="mb-1 inline-flex items-center rounded-xs bg-brand-100 px-1.5 py-0.5 font-medium text-[10px] text-brand-800">
              作者注
            </span>
          ) : null}
          {onLocate !== undefined ? (
            <button
              type="button"
              onClick={() => onLocate(c)}
              className="block max-w-full truncate text-left text-ink-400 text-xs italic transition-colors hover:text-brand-700"
              title={c.quotedText}
            >
              「{c.quotedText}」
            </button>
          ) : (
            <p className="truncate text-ink-400 text-xs italic" title={c.quotedText}>
              「{c.quotedText}」
            </p>
          )}
          <p className="mt-1 whitespace-pre-wrap text-ink-700 text-sm leading-relaxed">
            <MentionText text={c.text} />
          </p>
          <p className="mt-1 text-ink-400 text-xs">
            {c.isAuthorNote ? '作者' : c.authorName} · {c.createdAtLabel}
            {c.state === 'remapped' ? (
              <span className="ml-1.5 text-ochre-700">已重定位</span>
            ) : null}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** 卡内引文点击 → 滚到正文里对应高亮并闪烁 */
function scrollToMark(c: InlineCommentView) {
  const mark = document.querySelector<HTMLElement>(`mark.comment-mark[data-comment-id="${c.id}"]`);
  const target = mark ?? document.getElementById(`b-${c.blockId}`);
  if (target !== null) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    flash(target);
  }
}

/** 水平钳制 fixed 浮层的中心点，保证浮层整体留在视口内（margin=半宽+边距） */
function clampX(x: number, half: number): number {
  return Math.min(Math.max(x, half + 8), window.innerWidth - half - 8);
}

/**
 * 在块元素内高亮引文：以引文字符串为准在块 textContent 里定位（多处出现时取最接近 startHint 的），
 * 再把命中的 [start, end) 区间包成 <mark.comment-mark>。引文找不到则不高亮（边注仍在）。
 */
function highlightQuote(
  block: HTMLElement,
  quotedText: string,
  startHint: number,
  commentId: string,
): HTMLElement[] {
  const fullText = block.textContent ?? '';
  let idx = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  let from = 0;
  while (true) {
    const at = fullText.indexOf(quotedText, from);
    if (at === -1) {
      break;
    }
    const dist = Math.abs(at - startHint);
    if (dist < bestDist) {
      bestDist = dist;
      idx = at;
    }
    from = at + 1;
  }
  if (idx === -1) {
    return [];
  }
  return wrapRange(block, idx, idx + quotedText.length, commentId);
}

/**
 * 把块内 [start, end) 字符区间（以 textContent 为口径）包成 <mark.comment-mark>。
 * 区间可能横跨多个文本节点（如含链接/加粗），逐文本节点切分各自包裹；倒序处理避免偏移失效。
 */
function wrapRange(
  block: HTMLElement,
  start: number,
  end: number,
  commentId: string,
): HTMLElement[] {
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const segments: { node: Text; from: number; to: number }[] = [];
  let pos = 0;
  let node = walker.nextNode() as Text | null;
  while (node !== null) {
    const len = node.data.length;
    const from = Math.max(start, pos);
    const to = Math.min(end, pos + len);
    if (from < to) {
      segments.push({ node, from: from - pos, to: to - pos });
    }
    pos += len;
    if (pos >= end) {
      break;
    }
    node = walker.nextNode() as Text | null;
  }
  const marks: HTMLElement[] = [];
  for (const seg of segments.reverse()) {
    const range = document.createRange();
    range.setStart(seg.node, seg.from);
    range.setEnd(seg.node, seg.to);
    const mark = document.createElement('mark');
    mark.className = 'comment-mark';
    mark.dataset.commentId = commentId;
    try {
      range.surroundContents(mark);
      marks.push(mark);
    } catch {
      // 区间跨元素边界等异常：跳过该段，宁可不高亮也不破坏 DOM
    }
  }
  return marks;
}

/** 还原一个高亮 mark：把内容移回父节点并合并相邻文本节点。 */
function unwrapMark(mark: HTMLElement): void {
  const parent = mark.parentNode;
  if (parent === null) {
    return;
  }
  while (mark.firstChild !== null) {
    parent.insertBefore(mark.firstChild, mark);
  }
  parent.removeChild(mark);
  parent.normalize();
}

/** 短暂闪烁目标元素，提示定位落点。 */
function flash(el: HTMLElement): void {
  el.classList.add('flash-target');
  window.setTimeout(() => el.classList.remove('flash-target'), 1200);
}

/** 找到选区所在的段落块元素（section[id^="b-"][data-block-type="paragraph"]），跨块/非段落返回 null。 */
function closestParagraph(node: Node): HTMLElement | null {
  let el: Node | null = node;
  while (el !== null) {
    if (el instanceof HTMLElement && el.id.startsWith('b-')) {
      return el.dataset.blockType === 'paragraph' ? el : null;
    }
    el = el.parentNode;
  }
  return null;
}
