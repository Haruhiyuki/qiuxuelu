'use client';

// 提示框 NodeView：左侧色条 + 变体选择器（contentEditable=false）+ 可编辑正文（NodeViewContent）。
import { cn } from '@harublog/ui';
import { NodeViewContent, type NodeViewProps, NodeViewWrapper } from '@tiptap/react';

const VARIANTS: { value: string; label: string }[] = [
  { value: 'info', label: '提示' },
  { value: 'tip', label: '技巧' },
  { value: 'warn', label: '注意' },
  { value: 'danger', label: '警告' },
];

const VARIANT_CLASS: Record<string, string> = {
  info: 'border-brand-400 bg-brand-50',
  tip: 'border-moss-400 bg-moss-50',
  warn: 'border-amber-400 bg-amber-50',
  danger: 'border-accent-400 bg-accent-50',
};

export function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const variant = typeof node.attrs.variant === 'string' ? node.attrs.variant : 'info';
  return (
    <NodeViewWrapper
      as="aside"
      className={cn('my-4 rounded-sm border-l-4 p-3', VARIANT_CLASS[variant] ?? VARIANT_CLASS.info)}
    >
      {editor.isEditable ? (
        <div contentEditable={false} className="mb-2 flex gap-1">
          {VARIANTS.map((v) => (
            <button
              key={v.value}
              type="button"
              onClick={() => updateAttributes({ variant: v.value })}
              className={cn(
                'rounded-sm px-2 py-0.5 text-xs',
                variant === v.value ? 'bg-overlay text-on-overlay' : 'bg-paper-100 text-ink-500',
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
      ) : null}
      <NodeViewContent className="prose-zh" />
    </NodeViewWrapper>
  );
}
