// @harublog/editor —— 共享的 Tiptap 扩展集 / schema / 块身份插件 / kernel↔Tiptap 归一化。
// 内部依赖仅 @harublog/kernel（依赖铁律：editor 只依赖 kernel）。
export { BlockId } from './block-id';
export { Callout, type CalloutVariant } from './callout';
export { buildExtensions, getEditorSchema } from './extensions';
export { Figure, type FigureOptions } from './figure';
export { MathBlock } from './math-block';
export { kernelToTiptap, tiptapToKernel } from './normalize';
