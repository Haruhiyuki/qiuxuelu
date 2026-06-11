// web 编辑器扩展集 = 共享 schema（@harublog/editor，与 collab 网关一致）+ 仅 UI 的增强：
// Figure 挂 React NodeView、占位符、拖拽/粘贴上传。三个编辑器（单人/协作/建议）统一从这里取。
import { buildExtensions, Figure } from '@harublog/editor';
import type { Extensions } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { FigureView } from './figure-view';
import { createImageUpload } from './image-upload';
import { uploadImageFile } from './upload';

export interface ClientExtensionsOptions {
  collaboration?: boolean;
  placeholder?: string;
}

const DEFAULT_PLACEHOLDER = '开始写作……拖拽或粘贴图片即可插入';

export function clientExtensions(options: ClientExtensionsOptions = {}): Extensions {
  // 共享 schema 里的 figure 替换为带 React NodeView 的版本（schema 不变，仅渲染增强）
  const base = buildExtensions({ collaboration: options.collaboration }).filter(
    (ext) => ext.name !== 'figure',
  );
  const FigureWithView = Figure.extend({
    addNodeView() {
      return ReactNodeViewRenderer(FigureView);
    },
  });
  return [
    ...base,
    FigureWithView,
    Placeholder.configure({ placeholder: options.placeholder ?? DEFAULT_PLACEHOLDER }),
    createImageUpload(uploadImageFile),
  ];
}
