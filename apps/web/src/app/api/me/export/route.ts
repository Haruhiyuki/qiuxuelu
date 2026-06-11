// 个人数据导出（GDPR/最小化原则配套）：登录用户导出自己的资料、文章、建议、评论为 JSON。
import {
  comments,
  documents,
  getDb,
  publishedSnapshots,
  suggestions,
  user as userTable,
} from '@harublog/db';
import { desc, eq } from 'drizzle-orm';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: '请先登录' }, { status: 401 });
  }
  const uid = session.user.id;
  const db = getDb();

  const [profile, docs, sugg, cmts] = await Promise.all([
    db
      .select({
        id: userTable.id,
        name: userTable.name,
        email: userTable.email,
        bio: userTable.bio,
        educationStage: userTable.educationStage,
        createdAt: userTable.createdAt,
      })
      .from(userTable)
      .where(eq(userTable.id, uid))
      .limit(1),
    db
      .select({
        id: documents.id,
        slug: documents.slug,
        title: documents.title,
        status: documents.status,
        createdAt: documents.createdAt,
        publishedContent: publishedSnapshots.content,
      })
      .from(documents)
      .leftJoin(publishedSnapshots, eq(publishedSnapshots.documentId, documents.id))
      .where(eq(documents.ownerId, uid))
      .orderBy(desc(documents.createdAt)),
    db
      .select({
        id: suggestions.id,
        documentId: suggestions.documentId,
        status: suggestions.status,
        note: suggestions.note,
        createdAt: suggestions.createdAt,
      })
      .from(suggestions)
      .where(eq(suggestions.authorId, uid))
      .orderBy(desc(suggestions.createdAt)),
    db
      .select({
        id: comments.id,
        documentId: comments.documentId,
        kind: comments.kind,
        body: comments.body,
        status: comments.status,
        createdAt: comments.createdAt,
      })
      .from(comments)
      .where(eq(comments.authorId, uid))
      .orderBy(desc(comments.createdAt)),
  ]);

  const payload = {
    schema: 'harublog/personal-export@1',
    exportedAt: new Date().toISOString(),
    profile: profile[0] ?? null,
    documents: docs,
    suggestions: sugg,
    comments: cmts,
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': 'attachment; filename="harublog-my-data.json"',
      'cache-control': 'no-store',
    },
  });
}
