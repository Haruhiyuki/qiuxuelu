'use client';

// 行内批注岛（阅读端唯一的客户端交互）：
// 常态：正文里的高亮 + 段落旁的「批注点」（每段一颗带数量，对齐锚点、重叠向下避让）。右侧没有常驻批注栏。
// 点击：点批注点或正文高亮 → 在合适位置临时浮现该段批注框（桌面落在右栏批注点旁，窄屏落在高亮下方）。
// 撰写：选中段落文字 → 浮现「批注」入口（桌面=选区上方胶囊；触屏=底部固定按钮，避开原生选区菜单）
//   → 编辑（桌面=右栏对齐锚点的草稿卡；触屏=顶部浮层 + 遮罩，避开键盘）；编辑时所选文字按批注样式高亮。
// 锚点偏移以段落 DOM 的 textContent 为口径（= kernel extractText）。
import { Button } from '@harublog/ui';
import { MessageSquare, MessageSquarePlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
/** 批注点 / 草稿卡之间的最小间距（px）：点位重叠时据此向下避让 */
const CARD_GAP = 8;

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
  // 点击批注点 / 正文高亮 → 临时浮现的批注框（存锚点矩形，渲染时按上下空间翻转 + 限高）
  const [popover, setPopover] = useState<{
    blockId: string;
    cx: number;
    aTop: number;
    aBottom: number;
  } | null>(null);
  // 正文 mark 悬停 → 对应批注点提亮
  const [activeBlock, setActiveBlock] = useState<string | null>(null);
  // 是否宽屏（xl+，存在右栏放批注点/草稿卡）：决定编辑/浮现落在右栏还是浮层
  const [isWide, setIsWide] = useState(false);
  // 是否触屏（粗指针）：触屏选字会弹原生菜单，故「批注」入口改为底部固定按钮
  const [isTouch, setIsTouch] = useState(false);

  const railRef = useRef<HTMLElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const draftCardRef = useRef<HTMLDivElement | null>(null);
  // 批注点纵向定位：measured 翻真前走文档流（无 JS 时仍可读），翻真后绝对定位对齐锚点
  const [tops, setTops] = useState<Record<string, number>>({});
  const [railHeight, setRailHeight] = useState(0);
  const [measured, setMeasured] = useState(false);

  const cancelDraft = useCallback(() => {
    setOpen(false);
    setPending(null);
    setText('');
    setError(null);
    setNotice(null);
  }, []);

  // 按锚点段落分组（同段多条批注合入一颗点 / 一框）
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

  // 编辑中：把待批注的文字按批注样式高亮（is-draft），取消/提交后还原
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

  // 批注点 ↔ 正文 mark 互相提亮（直接切 class，不经 React 状态以免重排）
  const setMarksActive = useCallback((blockId: string, on: boolean) => {
    for (const mark of document.querySelectorAll<HTMLElement>(
      `mark.comment-mark[data-block-id="${blockId}"]`,
    )) {
      mark.classList.toggle('is-active', on);
    }
  }, []);

  // 正文内高亮：把每条批注的字符区间在对应段落里包成 <mark>；点击 → 临时浮现该段批注框。
  useEffect(() => {
    const onMarkClick = (e: Event) => {
      const el = e.currentTarget as HTMLElement;
      const blockId = el.dataset.blockId;
      if (blockId === undefined) {
        return;
      }
      // 桌面：浮现框落到右栏对应批注点旁；窄屏：落到被点高亮下方
      const anchor = isWide ? (cardRefs.current.get(blockId) ?? el) : el;
      const r = anchor.getBoundingClientRect();
      setPopover({
        blockId,
        cx: clampX(r.left + r.width / 2, 168),
        aTop: r.top,
        aBottom: r.bottom,
      });
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

  // 右栏批注点排版：点 top 对齐锚点段落，相邻向下避让；正文高度变化（图片等）时重算
  const layoutRail = useCallback(() => {
    const rail = railRef.current;
    if (rail === null || rail.offsetParent === null) {
      return;
    }
    const railTop = rail.getBoundingClientRect().top + window.scrollY;
    const entries: { blockId: string; anchor: number; height: number }[] = [];
    for (const g of groups) {
      const block = document.getElementById(`b-${g.blockId}`);
      const card = cardRefs.current.get(g.blockId);
      if (block === null || card === undefined) {
        continue;
      }
      entries.push({
        blockId: g.blockId,
        anchor: block.getBoundingClientRect().top + window.scrollY - railTop,
        height: card.offsetHeight,
      });
    }
    // 草稿卡也参与排版：对齐锚点段落、与批注点避让
    if (open && pending !== null && isWide) {
      const block = document.getElementById(`b-${pending.blockId}`);
      const card = draftCardRef.current;
      if (block !== null && card !== null) {
        entries.push({
          blockId: '__draft__',
          anchor: block.getBoundingClientRect().top + window.scrollY - railTop,
          height: card.offsetHeight,
        });
      }
    }
    entries.sort((a, b) => a.anchor - b.anchor);
    let cursor = 0;
    const next: Record<string, number> = {};
    for (const e of entries) {
      const top = Math.max(e.anchor, cursor);
      next[e.blockId] = top;
      cursor = top + e.height + CARD_GAP;
    }
    setTops((prev) => (sameTops(prev, next) ? prev : next));
    setRailHeight(cursor);
    setMeasured(true);
  }, [groups, open, pending, isWide]);

  useEffect(() => {
    if (open && isWide) {
      layoutRail();
    }
  }, [text, open, isWide, layoutRail]);

  useLayoutEffect(() => {
    layoutRail();
    const article = document.getElementById('article-body');
    const observer = article !== null ? new ResizeObserver(() => layoutRail()) : null;
    if (article !== null && observer !== null) {
      observer.observe(article);
    }
    window.addEventListener('resize', layoutRail);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', layoutRail);
    };
  }, [layoutRail]);

  // 浮现框打开期间，持续提亮其对应正文高亮
  useEffect(() => {
    if (popover === null) {
      return;
    }
    setMarksActive(popover.blockId, true);
    return () => setMarksActive(popover.blockId, false);
  }, [popover, setMarksActive]);

  // 浮现框：点外部或 Esc 关闭
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
        setOpen(false);
        setPending(null);
        setNotice(null);
        router.refresh();
      }
    } else {
      setError(result.error);
    }
    setBusy(false);
  }

  const popoverGroup =
    popover !== null ? (groups.find((g) => g.blockId === popover.blockId) ?? null) : null;

  // 浮现框定位：下方空间够（或比上方多）就向下展开，否则翻到上方；限高到可用空间，内部滚动 → 不溢出屏幕
  let popoverStyle: CSSProperties | undefined;
  if (popover !== null) {
    const spaceBelow = window.innerHeight - popover.aBottom;
    const spaceAbove = popover.aTop;
    const below = spaceBelow >= 220 || spaceBelow >= spaceAbove;
    const maxHeight = Math.max(140, (below ? spaceBelow : spaceAbove) - 16);
    popoverStyle = below
      ? { left: popover.cx, top: popover.aBottom + 8, maxHeight }
      : { left: popover.cx, bottom: window.innerHeight - popover.aTop + 8, maxHeight };
  }

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

      {/* 窄屏（无右栏）：编辑框为顶部居中浮层 + 遮罩，固定顶部避开键盘 */}
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

      {/* 临时批注框：点批注点 / 正文高亮后浮现，点外部或 Esc 关闭 */}
      {popover !== null && popoverGroup !== null ? (
        <div
          ref={popoverRef}
          style={popoverStyle}
          className="fade-in -translate-x-1/2 fixed z-30 flex w-[21rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-md border border-ink-200 bg-paper-50 shadow-float"
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
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <CommentList items={popoverGroup.items} onLocate={scrollToMark} />
          </div>
        </div>
      ) : null}

      {/* 右栏（xl+）：常态只有批注点（每段一颗带数量，对齐锚点、重叠向下避让）+ 编辑时的草稿卡 */}
      <aside
        ref={railRef}
        aria-label="行内批注"
        className="relative hidden xl:block"
        style={measured ? { minHeight: railHeight } : undefined}
      >
        {canComment && groups.length === 0 && !open ? (
          <p className="sticky top-24 border-ink-200 border-l-2 pl-3 text-ink-400 text-xs leading-relaxed">
            选中正文中的一段文字，
            <br />
            即可在此留下批注。
          </p>
        ) : null}
        {/* 草稿编辑卡：对齐锚点段落，临时浮现在右栏 */}
        {pending !== null && open && isWide ? (
          <div
            ref={draftCardRef}
            style={
              measured
                ? { position: 'absolute', top: tops.__draft__ ?? 0, left: 0, right: 0 }
                : undefined
            }
            className="pop-in z-10 mb-3 rounded-md border border-ochre-600/60 bg-paper-50 p-3 shadow-float ring-1 ring-ochre-600/15"
          >
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
        {groups.map((g) => {
          const active = activeBlock === g.blockId || popover?.blockId === g.blockId;
          return (
            <div
              key={g.blockId}
              ref={(el) => {
                if (el === null) {
                  cardRefs.current.delete(g.blockId);
                } else {
                  cardRefs.current.set(g.blockId, el);
                }
              }}
              style={
                measured
                  ? { position: 'absolute', top: tops[g.blockId] ?? 0, left: 0, right: 0 }
                  : undefined
              }
              className="flex transition-[top] duration-200"
            >
              <button
                type="button"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setPopover({
                    blockId: g.blockId,
                    cx: clampX(r.left + r.width / 2, 168),
                    aTop: r.top,
                    aBottom: r.bottom,
                  });
                }}
                onMouseEnter={() => setMarksActive(g.blockId, true)}
                onMouseLeave={() => setMarksActive(g.blockId, false)}
                aria-label={`查看本段批注（${g.items.length}）`}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs shadow-paper transition-colors ${
                  active
                    ? 'border-ochre-600/60 bg-ochre-50 text-ochre-800'
                    : 'border-ink-200 bg-paper-50 text-ink-500 hover:border-brand-300 hover:text-brand-700'
                }`}
              >
                <MessageSquare className="h-3 w-3" aria-hidden />
                {g.items.length}
              </button>
            </div>
          );
        })}
      </aside>
    </>
  );
}

/** 批注编辑框（右栏草稿卡与窄屏浮层共用）：引文小注 + @提及文本域 + 提交/取消。 */
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

/** 批注列表（浮现框内）：引文小注 + 正文 + 署名。作者注置顶。 */
function CommentList({
  items,
  onLocate,
}: {
  items: InlineCommentView[];
  onLocate?: (c: InlineCommentView) => void;
}) {
  // 作者注置顶（同一段内排在其它批注之上），其余保持原有时间顺序
  const ordered = [...items].sort((a, b) => Number(b.isAuthorNote) - Number(a.isAuthorNote));
  return (
    <ul className="flex flex-col gap-4">
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

/** 框内引文点击 → 滚到正文里对应高亮并闪烁 */
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

function sameTops(a: Record<string, number>, b: Record<string, number>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) {
    return false;
  }
  return ka.every((k) => a[k] === b[k]);
}

/**
 * 在块元素内高亮引文：以引文字符串为准在块 textContent 里定位（多处出现时取最接近 startHint 的），
 * 再把命中的 [start, end) 区间包成 <mark.comment-mark>。引文找不到则不高亮（批注点仍在）。
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
