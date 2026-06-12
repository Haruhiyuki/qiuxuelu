'use server';

// 知识图谱：点击节点切换中心时，按新中心重新取分层邻域子图。
// 图谱只覆盖「已发布」帖子（公开信息），无需鉴权；仅校验入参为 uuid。
import { z } from 'zod';
import { getDocGraphLayeredLive, type LayeredGraph } from '@/server/references';

const uuid = z.uuid();

export async function fetchDocGraph(centerId: string): Promise<LayeredGraph | null> {
  if (!uuid.safeParse(centerId).success) {
    return null;
  }
  return getDocGraphLayeredLive(centerId, 3);
}
