// 客户端图片上传：封装 FormData + uploadMedia 动作，供拖拽/粘贴扩展与工具栏共用。
import { uploadMedia } from '@/server/actions/media';

export interface UploadedImage {
  url: string;
  width: number;
  height: number;
}

/** 上传一张图片；失败返回 null（调用方提示）。 */
export async function uploadImageFile(file: File): Promise<UploadedImage | null> {
  const fd = new FormData();
  fd.append('file', file);
  const r = await uploadMedia(fd);
  return r.ok ? r.data : null;
}
