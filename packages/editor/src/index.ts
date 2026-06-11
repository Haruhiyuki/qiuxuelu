// @harublog/editor —— 共享的 Tiptap 扩展集 / schema / 块身份插件 / kernel↔Tiptap 归一化。
// 内部依赖仅 @harublog/kernel（依赖铁律：editor 只依赖 kernel）。
export { BlockId } from './block-id';
export {
  type BuildExtensionsOptions,
  buildExtensions,
  COLLAB_FRAGMENT,
  getEditorSchema,
} from './extensions';
export { kernelToTiptap, tiptapToKernel } from './normalize';
