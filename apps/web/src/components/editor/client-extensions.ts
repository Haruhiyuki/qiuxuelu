// web 编辑器扩展集 = 共享 schema（@harublog/editor，与 collab 网关一致）+ 仅 UI 的增强：
// Figure 挂 React NodeView、占位符、拖拽/粘贴上传。三个编辑器（单人/协作/建议）统一从这里取。
import { buildExtensions, Callout, Figure, MathBlock } from '@harublog/editor';
import type { Extensions } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { CalloutView } from './callout-view';
import { FigureView } from './figure-view';
import { createImageUpload } from './image-upload';
import { MathBlockView } from './math-block-view';
import { uploadImageFile } from './upload';

export interface ClientExtensionsOptions {
  collaboration?: boolean;
  placeholder?: string;
}

const DEFAULT_PLACEHOLDER = '开始写作……拖拽或粘贴图片即可插入';

const WITH_NODE_VIEW = new Set(['figure', 'callout', 'mathBlock']);

export function clientExtensions(options: ClientExtensionsOptions = {}): Extensions {
  // 共享 schema 里需要交互的块替换为带 React NodeView 的版本（schema 不变，仅渲染增强）
  const base = buildExtensions({ collaboration: options.collaboration }).filter(
    (ext) => !WITH_NODE_VIEW.has(ext.name),
  );
  const FigureWithView = Figure.extend({
    addNodeView: () => ReactNodeViewRenderer(FigureView),
  });
  const CalloutWithView = Callout.extend({
    addNodeView: () => ReactNodeViewRenderer(CalloutView),
  });
  const MathWithView = MathBlock.extend({
    addNodeView: () => ReactNodeViewRenderer(MathBlockView),
  });
  return [
    ...base,
    FigureWithView,
    CalloutWithView,
    MathWithView,
    Placeholder.configure({ placeholder: options.placeholder ?? DEFAULT_PLACEHOLDER }),
    createImageUpload(uploadImageFile),
  ];
}
