'use client';

// 图片块 React NodeView：展示图片 + 行内编辑「说明 / 替代文本」。控件区 contentEditable=false，
// 避免 ProseMirror 把表单输入当文档编辑。alt 是无障碍刚需，显式提示填写。
import { cn } from '@harublog/ui';
import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react';

export function FigureView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const src = typeof node.attrs.src === 'string' ? node.attrs.src : '';
  const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : '';
  const caption = typeof node.attrs.caption === 'string' ? node.attrs.caption : '';
  const editable = editor.isEditable;

  return (
    <NodeViewWrapper
      as="figure"
      className={cn(
        'my-4 flex flex-col gap-2 rounded-sm',
        selected && editable ? 'outline outline-2 outline-brand-400' : '',
      )}
    >
      {src.length > 0 ? (
        <img src={src} alt={alt} loading="lazy" className="max-w-full rounded-sm" />
      ) : (
        <div className="flex h-32 items-center justify-center rounded-sm bg-paper-200 text-ink-400 text-sm">
          图片上传中…
        </div>
      )}

      {editable ? (
        <div contentEditable={false} className="flex flex-col gap-1.5">
          <input
            value={caption}
            onChange={(e) => updateAttributes({ caption: e.target.value })}
            placeholder="图片说明（可选）"
            className="w-full rounded-sm border border-ink-200 bg-paper-50 px-2 py-1 text-center text-ink-600 text-sm"
          />
          <input
            value={alt}
            onChange={(e) => updateAttributes({ alt: e.target.value })}
            placeholder="替代文本（无障碍，建议填写）"
            className="w-full rounded-sm border border-ink-200 bg-paper-50 px-2 py-1 text-ink-500 text-xs"
          />
        </div>
      ) : caption.length > 0 ? (
        <figcaption className="text-center text-ink-500 text-sm">{caption}</figcaption>
      ) : null}
    </NodeViewWrapper>
  );
}
