'use client';

// 实时修订器（架构 §6.3 C 阶）：Yjs + Hocuspocus，仅草稿态、仅授权用户。
// 不在客户端保存——服务端按防抖把 Y.Doc 快照为 collab_checkpoint 修订（修订才是真相）。
import { COLLAB_FRAGMENT } from '@harublog/editor';
import { Alert } from '@harublog/ui';
import { HocuspocusProvider } from '@hocuspocus/provider';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { EditorContent, useEditor } from '@tiptap/react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import { issueCollabToken } from '@/server/actions/collab';
import { BubbleToolbar } from './bubble-toolbar';
import { clientExtensions } from './client-extensions';
import { TableToolbar } from './table-toolbar';
import { EditorToolbar } from './toolbar';

const COLLAB_URL = process.env.NEXT_PUBLIC_COLLAB_URL ?? 'ws://localhost:3201';

/** 从名字派生一个稳定的光标颜色（避免 Math.random，保证同人同色）。 */
function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) % 360;
  }
  return `hsl(${h} 65% 45%)`;
}

interface InnerProps {
  docId: string;
  token: string;
  userName: string;
}

function RealtimeInner({ docId, token, userName }: InnerProps) {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [peers, setPeers] = useState<string[]>([]);

  // ydoc + provider 在组件生命周期内只建一次
  const { ydoc, provider } = useMemo(() => {
    const doc = new Y.Doc();
    const prov = new HocuspocusProvider({
      url: COLLAB_URL,
      name: docId,
      token,
      document: doc,
    });
    return { ydoc: doc, provider: prov };
  }, [docId, token]);

  useEffect(() => {
    const onStatus = (e: { status: string }) => {
      setStatus(e.status === 'connected' ? 'connected' : 'connecting');
    };
    const onAwareness = () => {
      const states = provider.awareness?.getStates();
      const names = states
        ? [...states.values()]
            .map((s) => (s as { user?: { name?: string } }).user?.name)
            .filter((n): n is string => typeof n === 'string')
        : [];
      setPeers([...new Set(names)]);
    };
    provider.on('status', onStatus);
    provider.on('awarenessUpdate', onAwareness);
    return () => {
      provider.off('status', onStatus);
      provider.off('awarenessUpdate', onAwareness);
      provider.destroy();
      ydoc.destroy();
    };
  }, [provider, ydoc]);

  const editor = useEditor({
    extensions: [
      ...clientExtensions({ collaboration: true }),
      Collaboration.configure({ document: ydoc, field: COLLAB_FRAGMENT }),
      CollaborationCaret.configure({
        provider,
        user: { name: userName, color: colorFor(userName) },
      }),
    ],
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'prose-zh min-h-[55vh] px-6 py-6 focus:outline-none',
        'aria-label': '实时修订区',
      },
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span
          className={
            status === 'connected'
              ? 'text-moss-700'
              : status === 'connecting'
                ? 'text-ink-500'
                : 'text-accent-700'
          }
          aria-live="polite"
        >
          {status === 'connected' ? '● 已连接' : status === 'connecting' ? '○ 连接中…' : '○ 已断开'}
        </span>
        <span className="text-ink-500">
          在线协作者：{peers.length > 0 ? peers.join('、') : userName}
        </span>
      </div>

      <div className="overflow-hidden rounded-sm border border-ink-200 bg-paper-50">
        {editor ? (
          <>
            <EditorToolbar editor={editor} />
            <BubbleToolbar editor={editor} />
            <TableToolbar editor={editor} />
            <EditorContent editor={editor} />
          </>
        ) : (
          <p className="px-6 py-10 text-ink-500 text-sm">编辑器加载中…</p>
        )}
      </div>

      <p className="text-ink-400 text-xs">
        协作内容会自动同步并定期归档为修订；无需手动保存。修订是唯一的历史与审计真相。
      </p>
    </div>
  );
}

export interface RealtimeEditorProps {
  docId: string;
  slug: string;
  title: string;
  userName: string;
}

export function RealtimeEditor({ docId, slug, title, userName }: RealtimeEditorProps) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    issueCollabToken(docId).then((r) => {
      if (!alive) {
        return;
      }
      if (r.ok) {
        setToken(r.data.token);
      } else {
        setError(r.error);
      }
    });
    return () => {
      alive = false;
    };
  }, [docId]);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-semibold font-serif text-ink-900 text-xl">修订：{title}</h1>
        <Link href={`/write/${docId}`} className="text-brand-700 text-sm hover:text-brand-900">
          返回单人编辑
        </Link>
      </header>
      {error !== null ? (
        <Alert variant="danger">{error}</Alert>
      ) : token === null ? (
        <p className="text-ink-500 text-sm">正在建立协作会话…</p>
      ) : (
        <RealtimeInner docId={docId} token={token} userName={userName} />
      )}
      <p className="text-ink-400 text-xs">
        <Link href={`/a/${slug}/history`} className="hover:text-brand-700">
          查看修订历史（含协作快照）→
        </Link>
      </p>
    </div>
  );
}
