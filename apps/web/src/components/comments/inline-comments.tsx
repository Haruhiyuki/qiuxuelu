'use client';

// 行内批注岛（阅读端唯一的客户端交互），三种形态合一：
// 1. 撰写：选中段落文字 → 浮动「批注」按钮 → 锚定提交（fixed 浮窗）；
// 2. 宽屏（xl+）：批注以边注卡片呈现在正文右侧栏，按锚点段落纵向对齐、堆叠避让——
//    批注回到它针对的文字旁边，而不是沉到页尾；
// 3. 窄屏：点击正文高亮 <mark> 弹出浮窗展示该段批注。
// 锚点偏移以段落 DOM 的 textContent 为口径（= kernel extractText）。
import { Button } from '@harublog/ui';
import { useRouter } from 'next/navigation';
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
/** 边注卡片之间的最小间距（px） */
const CARD_GAP = 12;

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
  // 正文 mark 悬停 → 对应边注卡提亮
  const [activeBlock, setActiveBlock] = useState<string | null>(null);

  const railRef = useRef<HTMLElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  // 边注卡纵向定位：measured 翻真前卡片走文档流（无 JS 时仍可读），翻真后改绝对定位对齐锚点
  const [tops, setTops] = useState<Record<string, number>>({});
  const [railHeight, setRailHeight] = useState(0);
  const [measured, setMeasured] = useState(false);

  // 按锚点段落分组（卡片以段落为单位对齐；同段多条批注合入一张卡）
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
      // fixed 定位用视口坐标，规避「定位祖先」问题；水平向钳制在视口内
      x: clampX(rect.left + rect.width / 2, 176),
      y: rect.top,
    });
  }, [canComment, open]);

  useEffect(() => {
    document.addEventListener('mouseup', captureSelection);
    return () => document.removeEventListener('mouseup', captureSelection);
  }, [captureSelection]);

  // 正文内高亮：把每条批注的字符区间在对应段落里包成 <mark>。
  // 点击：宽屏（边注栏可见）闪烁对应边注卡；窄屏弹出批注浮窗。悬停与边注卡互相提亮。
  // 偏移口径 = 段落 textContent（与 captureSelection / kernel extractText 一致；worker 已在发布时重映射）。
  useEffect(() => {
    const onMarkClick = (e: Event) => {
      const el = e.currentTarget as HTMLElement;
      const blockId = el.dataset.blockId;
      if (blockId === undefined) {
        return;
      }
      const rail = railRef.current;
      if (rail !== null && rail.offsetParent !== null) {
        const card = cardRefs.current.get(blockId);
        if (card !== null && card !== undefined) {
          flash(card);
          return;
        }
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
  }, [comments]);

  // 边注卡悬停 → 正文对应 mark 提亮（直接切 class，不经 React 状态以免重排）
  const setMarksActive = useCallback((blockId: string, on: boolean) => {
    for (const mark of document.querySelectorAll<HTMLElement>(
      `mark.comment-mark[data-block-id="${blockId}"]`,
    )) {
      mark.classList.toggle('is-active', on);
    }
  }, []);

  // 边注栏排版：卡片 top 对齐锚点段落，相邻卡片堆叠避让；正文高度变化（图片加载等）时重算
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
  }, [groups]);

  useLayoutEffect(() => {
    layoutRail();
    // 正文容器高度变化（图片/数学渲染）会移动锚点段落，观察它而非逐段观察
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

  return (
    <>
      {pending !== null && !open ? (
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            setOpen(true);
          }}
          style={{ left: pending.x, top: pending.y - 40 }}
          className="-translate-x-1/2 fixed z-30 rounded-sm bg-overlay px-2.5 py-1 font-medium text-on-overlay text-xs shadow-float transition-colors hover:bg-overlay-hover"
        >
          批注「{pending.quotedText.slice(0, 12)}
          {pending.quotedText.length > 12 ? '…' : ''}」
        </button>
      ) : null}

      {pending !== null && open ? (
        <div
          style={{ left: pending.x, top: pending.y + 8 }}
          className="-translate-x-1/2 fixed z-30 w-80 rounded-md border border-ink-200 bg-paper-50 p-3 shadow-float"
        >
          <p className="mb-2 border-ochre-600 border-l-2 pl-2 text-ink-500 text-sm">
            {pending.quotedText.slice(0, 60)}
          </p>
          <MentionTextarea
            value={text}
            onChange={setText}
            rows={3}
            placeholder="写下针对这段文字的批注…（用 @ 提及他人）"
            disabled={busy}
          />
          {error !== null ? <p className="mt-1 text-accent-700 text-sm">{error}</p> : null}
          {notice !== null ? <p className="mt-1 text-moss-700 text-sm">{notice}</p> : null}
          <div className="mt-2 flex items-center gap-3">
            <Button type="button" size="sm" onClick={submit} disabled={busy}>
              {busy ? '提交中…' : '提交批注'}
            </Button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setText('');
                setError(null);
                setNotice(null);
              }}
              className="text-ink-500 text-sm hover:text-ink-700"
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      {/* 窄屏批注浮窗：锚定在被点击的 mark 下方 */}
      {popover !== null && popoverGroup !== null ? (
        <div
          ref={popoverRef}
          style={{ left: popover.x, top: popover.y }}
          className="-translate-x-1/2 fixed z-30 max-h-[60vh] w-[21rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border border-ink-200 bg-paper-50 p-4 shadow-float"
          role="dialog"
          aria-label="本段批注"
        >
          <div className="flex items-center justify-between">
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
          <div className="mt-3">
            <CommentList items={popoverGroup.items} />
          </div>
        </div>
      ) : null}

      {/* 宽屏边注栏（文章页网格第三栏）：卡片对齐锚点段落。
       * measured 前卡片走文档流（无 JS 也可读），measured 后绝对定位。 */}
      <aside
        ref={railRef}
        aria-label="行内批注"
        className="relative hidden xl:block"
        style={measured ? { minHeight: railHeight } : undefined}
      >
        {canComment && groups.length === 0 ? (
          <p className="sticky top-24 border-ink-200 border-l-2 pl-3 text-ink-400 text-xs leading-relaxed">
            选中正文中的一段文字，
            <br />
            即可在此留下批注。
          </p>
        ) : null}
        {groups.map((g) => (
          // biome-ignore lint/a11y/noStaticElementInteractions: 悬停联动是纯装饰增强；键盘/读屏的定位路径由卡内引文按钮承担
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
            onMouseEnter={() => setMarksActive(g.blockId, true)}
            onMouseLeave={() => setMarksActive(g.blockId, false)}
            className={`mb-3 rounded-md border bg-paper-50 p-3 shadow-paper transition-[top,border-color,box-shadow] duration-200 ${
              activeBlock === g.blockId
                ? 'border-ochre-600/60 shadow-lift'
                : 'border-ink-200 hover:border-ink-300'
            }`}
          >
            <CommentList items={g.items} compact onLocate={scrollToMark} />
          </div>
        ))}
      </aside>
    </>
  );
}

/** 批注列表（边注卡与浮窗共用）：引文小注 + 正文 + 署名 */
function CommentList({
  items,
  compact = false,
  onLocate,
}: {
  items: InlineCommentView[];
  compact?: boolean;
  onLocate?: (c: InlineCommentView) => void;
}) {
  return (
    <ul className={`flex flex-col ${compact ? 'gap-3' : 'gap-4'}`}>
      {items.map((c) => (
        <li key={c.id} className="group/item">
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
            {c.authorName} · {c.createdAtLabel}
            {c.state === 'remapped' ? (
              <span className="ml-1.5 text-ochre-700">已重定位</span>
            ) : null}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** 边注卡引文点击 → 滚到正文里对应高亮并闪烁 */
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
 * 再把命中的 [start, end) 区间包成 <mark.comment-mark>。
 * 之所以按引文搜索而非直接用存储偏移：DOM textContent 与 kernel extractText 的口径可能有细微差异
 * （装饰性节点等），引文搜索对此免疫，offset 仅作多处出现时的消歧提示。引文找不到则不高亮（边注仍在）。
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
