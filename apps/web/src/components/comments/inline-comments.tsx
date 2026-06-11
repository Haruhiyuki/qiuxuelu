'use client';

// 行内批注岛（阅读端唯一的客户端交互）：选中段落文字 → 浮动「批注」按钮 → 锚定提交；
// 同时渲染已有行内批注面板。锚点偏移以段落 DOM 的 textContent 为口径（= kernel extractText）。
import { Button, Textarea } from '@harublog/ui';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createInlineComment } from '@/server/actions/comment';

export interface InlineCommentView {
  id: string;
  blockId: string;
  quotedText: string;
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
          className="-translate-x-1/2 fixed z-20 rounded-sm bg-ink-900 px-2.5 py-1 font-medium text-paper-50 text-xs shadow-md"
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
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="写下针对这段文字的批注…"
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
              <li key={c.id} className="border-ink-100 border-l-2 pl-3">
                <a
                  href={`#b-${c.blockId}`}
                  className="text-ink-500 text-sm italic hover:text-brand-700"
                >
                  「{c.quotedText.slice(0, 50)}」
                </a>
                {c.state !== 'live' ? (
                  <span className="ml-2 text-accent-600 text-xs">{STATE_LABEL[c.state]}</span>
                ) : null}
                <p className="mt-1 whitespace-pre-wrap text-ink-700 text-sm leading-relaxed">
                  {c.text}
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
