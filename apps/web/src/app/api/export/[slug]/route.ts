// 公开只读单篇导出 API（CC BY-SA 开放语料）：GET /api/export/<slug> → 可移植 JSON。
import { buildDocumentExport, documents, getDb } from '@harublog/db';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const db = getDb();
  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.slug, slug))
    .limit(1);
  const docId = rows[0]?.id;
  if (docId === undefined) {
    return Response.json({ error: '文章不存在' }, { status: 404 });
  }
  const data = await buildDocumentExport(db, docId);
  if (data === null) {
    return Response.json({ error: '文章未发布' }, { status: 404 });
  }
  return Response.json(data, {
    headers: {
      // 公开开放语料，允许跨源读取与缓存
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=300',
    },
  });
}
