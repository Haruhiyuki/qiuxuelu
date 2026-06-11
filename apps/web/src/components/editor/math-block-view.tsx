'use client';

// 数学块 NodeView：LaTeX 源输入（atom，无可编辑正文）+ 源码预览。
// KaTeX 实时渲染为后续打磨项；当前与渲染器一致以 .math-block 展示源码。
import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react';

export function MathBlockView({ node, updateAttributes, editor }: NodeViewProps) {
  const latex = typeof node.attrs.latex === 'string' ? node.attrs.latex : '';
  return (
    <NodeViewWrapper as="div" className="my-4">
      {editor.isEditable ? (
        <textarea
          value={latex}
          onChange={(e) => updateAttributes({ latex: e.target.value })}
          placeholder="输入 LaTeX，例如 a^2 + b^2 = c^2"
          rows={2}
          className="w-full rounded-sm border border-ink-200 bg-paper-50 px-3 py-2 font-mono text-ink-700 text-sm"
        />
      ) : null}
      <pre className="math-block overflow-x-auto rounded-sm bg-paper-100 px-3 py-2 text-ink-700 text-sm">
        {latex.length > 0 ? latex : '（空公式）'}
      </pre>
    </NodeViewWrapper>
  );
}
