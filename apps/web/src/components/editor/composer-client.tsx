'use client';

// 撰写器只在客户端渲染（ssr:false）：tiptap/ProseMirror 不应在服务端渲染，
// 且服务端渲染它会触发 useRef 空指针，进而连累「服务端动作响应重渲染本页」失败。
// 客户端独占后，服务端只渲染占位骨架，动作往返不再受编辑器牵连。
import dynamic from 'next/dynamic';
import type { ArticleComposerProps } from './article-composer';

const ArticleComposer = dynamic(() => import('./article-composer').then((m) => m.ArticleComposer), {
  ssr: false,
  loading: () => (
    <div className="mx-auto w-full max-w-[44rem] px-6 py-16 text-ink-400 text-sm">
      写作台加载中…
    </div>
  ),
});

export function ComposerClient(props: ArticleComposerProps) {
  return <ArticleComposer {...props} />;
}
