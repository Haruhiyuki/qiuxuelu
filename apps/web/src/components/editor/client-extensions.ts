// web 编辑器扩展集 = 共享 schema（@harublog/editor）+ 仅 UI 的增强：
// Figure 挂 React NodeView、占位符、拖拽/粘贴上传。各编辑器（撰写/协作直编/修订）统一从这里取。
import { buildExtensions, Callout, Figure, MathBlock } from '@harublog/editor';
import type { Extensions } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { BlockJoinBackspace } from './block-join-backspace';
import { CalloutView } from './callout-view';
import { FigureView } from './figure-view';
import { createImageUpload } from './image-upload';
import { IosComposeEnter } from './ios-compose-enter';
import { MathBlockView } from './math-block-view';
import { SlashCommand } from './slash-command';
import { uploadImageFile } from './upload';

export interface ClientExtensionsOptions {
  placeholder?: string;
}

const DEFAULT_PLACEHOLDER = '开始写作……拖拽或粘贴图片即可插入';

const WITH_NODE_VIEW = new Set(['figure', 'callout', 'mathBlock']);

export function clientExtensions(options: ClientExtensionsOptions = {}): Extensions {
  // 共享 schema 里需要交互的块替换为带 React NodeView 的版本（schema 不变，仅渲染增强）
  const base = buildExtensions().filter((ext) => !WITH_NODE_VIEW.has(ext.name));
  const FigureWithView = Figure.extend({
    // 同 mathBlock：figure 也是 atom，说明/替代文本输入框的事件交给它自己（防被当成文档编辑）
    addNodeView: () =>
      ReactNodeViewRenderer(FigureView, {
        stopEvent: ({ event }) => (event.target as HTMLElement | null)?.tagName === 'INPUT',
      }),
  });
  const CalloutWithView = Callout.extend({
    addNodeView: () => ReactNodeViewRenderer(CalloutView),
  });
  const MathWithView = MathBlock.extend({
    // stopEvent：公式块是 atom，但 NodeView 内有 LaTeX 输入框——textarea 的
    // 键盘/输入/点击/选区事件必须让它自己消化，否则会被 ProseMirror 拦截，
    // 表现为「输入任意内容覆盖整个公式块」（atom 被 NodeSelection 选中时打字即替换）。
    addNodeView: () =>
      ReactNodeViewRenderer(MathBlockView, {
        stopEvent: ({ event }) => (event.target as HTMLElement | null)?.tagName === 'TEXTAREA',
      }),
  });
  return [
    ...base,
    FigureWithView,
    CalloutWithView,
    MathWithView,
    SlashCommand,
    BlockJoinBackspace,
    IosComposeEnter,
    Placeholder.configure({ placeholder: options.placeholder ?? DEFAULT_PLACEHOLDER }),
    createImageUpload(uploadImageFile),
  ];
}
