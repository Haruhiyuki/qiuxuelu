// 拖拽 / 粘贴图片自动上传扩展：拦截带图片文件的 drop/paste，异步上传后插入 figure 块。
// blockId 由 BlockId 插件的 appendTransaction 自动补发（figure 在 TOP_BLOCK_TYPES）。
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { UploadedImage } from './upload';

type UploadFn = (file: File) => Promise<UploadedImage | null>;

function imagesFrom(list: DataTransferItemList | undefined): File[] {
  const files: File[] = [];
  for (const item of list ? Array.from(list) : []) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile();
      if (f) {
        files.push(f);
      }
    }
  }
  return files;
}

export function createImageUpload(upload: UploadFn): Extension {
  return Extension.create({
    name: 'imageUpload',
    addProseMirrorPlugins() {
      const editor = this.editor;
      const insertAt = async (file: File, pos: number) => {
        const uploaded = await upload(file);
        if (uploaded === null) {
          return;
        }
        editor
          .chain()
          .insertContentAt(pos, {
            type: 'figure',
            attrs: { src: uploaded.url, alt: '', caption: '' },
          })
          .run();
      };
      return [
        new Plugin({
          key: new PluginKey('imageUpload'),
          props: {
            handlePaste(view, event) {
              const files = imagesFrom(event.clipboardData?.items);
              if (files.length === 0) {
                return false;
              }
              event.preventDefault();
              const pos = view.state.selection.from;
              for (const f of files) {
                void insertAt(f, pos);
              }
              return true;
            },
            handleDrop(view, event) {
              const files = imagesFrom(event.dataTransfer?.items);
              if (files.length === 0) {
                return false;
              }
              event.preventDefault();
              const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
              const pos = coords?.pos ?? view.state.selection.from;
              for (const f of files) {
                void insertAt(f, pos);
              }
              return true;
            },
          },
        }),
      ];
    },
  });
}
