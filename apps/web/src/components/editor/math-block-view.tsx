'use client';

// 数学块 NodeView：LaTeX 源输入（atom，无可编辑正文）+ 实时渲染预览。
// 预览直接复用阅读端 renderMath（KaTeX→MathML），保证「所见即所得」——编辑器里看到的
// 与发布后完全一致；throwOnError:false 下不合法/半成品 LaTeX 由 KaTeX 自身红字提示。
import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react';
import { useEffect, useMemo, useRef } from 'react';
import { renderMath } from '@/lib/math';

export function MathBlockView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const latex = typeof node.attrs.latex === 'string' ? node.attrs.latex : '';
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const mountFocused = useRef(false);

  // 预览随 latex 变化重算（renderMath 内部 try/catch 兜底，非法输入也不抛）
  const preview = useMemo(() => renderMath(latex), [latex]);

  // 把焦点交给 LaTeX 输入框：①刚插入的空公式块（mount 时 latex 为空）自动聚焦——
  // 否则焦点留在 ProseMirror，打字会落到文档里、甚至替换掉这个 atom 节点（即「输入即覆盖」）；
  // ②之后点选该块也聚焦输入框。仅依赖 selected/editable：latex 变化不应触发重新抢焦点。
  useEffect(() => {
    if (!editor.isEditable) {
      return;
    }
    const shouldFocus = selected || (!mountFocused.current && latex === '');
    mountFocused.current = true;
    if (shouldFocus) {
      // rAF 延后到 ProseMirror 自身 focus/选区同步之后再抢焦点，避免被 PM 夺回
      const raf = requestAnimationFrame(() => ref.current?.focus());
      return () => cancelAnimationFrame(raf);
    }
  }, [selected, editor.isEditable]);

  return (
    <NodeViewWrapper as="div" className="my-4" data-math-block="">
      {editor.isEditable ? (
        <textarea
          ref={ref}
          value={latex}
          onChange={(e) => updateAttributes({ latex: e.target.value })}
          // 阻止冒泡到 ProseMirror，确保键盘/退格等都在 textarea 内生效
          onKeyDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder="输入 LaTeX，例如 a^2 + b^2 = c^2"
          rows={2}
          className="w-full rounded-sm border border-ink-200 bg-paper-50 px-3 py-2 font-mono text-ink-700 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        />
      ) : null}
      <div className="mt-2 overflow-x-auto rounded-sm bg-paper-100 px-3 py-2">
        {latex.length > 0 ? (
          preview
        ) : (
          <span className="text-ink-400 text-sm">（空公式，在上方输入 LaTeX 即时预览）</span>
        )}
      </div>
    </NodeViewWrapper>
  );
}
