'use client';

// 行内批注岛（阅读端唯一的客户端交互）：选中段落文字 → 浮动「批注」按钮 → 锚定提交；
// 同时渲染已有行内批注面板。锚点偏移以段落 DOM 的 textContent 为口径（= kernel extractText）。
import { Button } from '@harublog/ui';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
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

const CTX = 16;
const STATE_LABEL: Record<InlineCommentView['state'], string> = {
  live: '',
  remapped: '已重定位',
  orphaned: '原文已改（失锚）',
};

export function InlineComments({
  docId,
  canComment,
  comments,
}: {
  docId: string;
  canComment: boolean;
  comments: InlineCommentView[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingAnchor | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

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
      // fixed 定位用视口坐标，规避「定位祖先」问题
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  }, [canComment, open]);

  useEffect(() => {
    document.addEventListener('mouseup', captureSelection);
    return () => document.removeEventListener('mouseup', captureSelection);
  }, [captureSelection]);

  // 正文内高亮：把每条（未失锚的）批注的字符区间在对应段落里包成 <mark>，点击跳到右侧批注。
  // 偏移口径 = 段落 textContent（与 captureSelection / kernel extractText 一致；worker 已在发布时重映射）。
  useEffect(() => {
    const onMarkClick = (e: Event) => {
      const id = (e.currentTarget as HTMLElement).dataset.commentId;
      if (id === undefined) {
        return;
      }
      const item = document.getElementById(`inline-comment-${id}`);
      if (item !== null) {
        item.scrollIntoView({ behavior: 'smooth', block: 'center' });
        flash(item);
      }
    };
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
        mark.addEventListener('click', onMarkClick);
        created.push(mark);
      }
    }
    return () => {
      for (const mark of created) {
        mark.removeEventListener('click', onMarkClick);
        unwrapMark(mark);
      }
    };
  }, [comments]);

  // 列表 → 正文：点批注引文，滚到正文里那段高亮并闪一下。
  function scrollToAnchor(c: InlineCommentView) {
    const mark = document.querySelector<HTMLElement>(
      `mark.comment-mark[data-comment-id="${c.id}"]`,
    );
    const target = mark ?? document.getElementById(`b-${c.blockId}`);
    if (target !== null) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      flash(target);
    }
  }

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
      setOpen(false);
      setPending(null);
      setText('');
      router.refresh();
    } else {
      setError(result.error);
    }
    setBusy(false);
  }

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
          className="-translate-x-1/2 fixed z-20 rounded-sm bg-ink-900 px-2.5 py-1 font-medium text-on-fill text-xs shadow-md"
        >
          批注「{pending.quotedText.slice(0, 12)}
          {pending.quotedText.length > 12 ? '…' : ''}」
        </button>
      ) : null}

      {pending !== null && open ? (
        <div
          ref={boxRef}
          style={{ left: pending.x, top: pending.y + 8 }}
          className="-translate-x-1/2 fixed z-20 w-80 rounded-sm border border-ink-200 bg-paper-50 p-3 shadow-lg"
        >
          <p className="mb-2 border-ink-200 border-l-2 pl-2 text-sm text-ink-500">
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
              }}
              className="text-ink-500 text-sm hover:text-ink-700"
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      <section className="mt-10 border-ink-200 border-t pt-6">
        <h2 className="font-semibold font-serif text-ink-900 text-lg">
          行内批注（{comments.length}）
        </h2>
        {canComment ? (
          <p className="mt-1 text-ink-400 text-xs">在正文段落中选中文字即可添加批注。</p>
        ) : null}
        {comments.length === 0 ? (
          <p className="mt-4 text-ink-400 text-sm">还没有行内批注。</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {comments.map((c) => (
              <li
                key={c.id}
                id={`inline-comment-${c.id}`}
                className="scroll-mt-24 border-ink-100 border-l-2 pl-3"
              >
                <button
                  type="button"
                  onClick={() => scrollToAnchor(c)}
                  className="text-left text-ink-500 text-sm italic hover:text-brand-700"
                >
                  「{c.quotedText.slice(0, 50)}」
                </button>
                {c.state !== 'live' ? (
                  <span className="ml-2 text-accent-600 text-xs">{STATE_LABEL[c.state]}</span>
                ) : null}
                <p className="mt-1 whitespace-pre-wrap text-ink-700 text-sm leading-relaxed">
                  <MentionText text={c.text} />
                </p>
                <p className="mt-0.5 text-ink-400 text-xs">
                  {c.authorName} · {c.createdAtLabel}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/**
 * 在块元素内高亮引文：以引文字符串为准在块 textContent 里定位（多处出现时取最接近 startHint 的），
 * 再把命中的 [start, end) 区间包成 <mark.comment-mark>。
 * 之所以按引文搜索而非直接用存储偏移：DOM textContent 与 kernel extractText 的口径可能有细微差异
 * （装饰性节点等），引文搜索对此免疫，offset 仅作多处出现时的消歧提示。引文找不到则不高亮（列表仍在）。
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
