// 博客互动状态读取（非 Server Action）：赞/踩计数 + 当前用户状态 + 最近点赞者。
import { type Database, docReactions, user as userTable } from '@harublog/db';
import { and, count, desc, eq, inArray } from 'drizzle-orm';

export type VoteDirection = 'like' | 'dislike';
export const DOC_LIKER_LIMIT = 30;

export interface DocLiker {
  id: string;
  name: string;
  image: string | null;
  likedAt: string;
}

export interface ReactionState {
  likeCount: number;
  dislikeCount: number;
  /** 当前用户的投票方向；未登录或未投为 null */
  myVote: VoteDirection | null;
  bookmarked: boolean;
  likers: DocLiker[];
  likerLimit: number;
}

export async function getDocLikers(
  db: Pick<Database, 'select'>,
  docId: string,
  limit = DOC_LIKER_LIMIT,
): Promise<DocLiker[]> {
  const rows = await db
    .select({
      id: userTable.id,
      name: userTable.name,
      image: userTable.image,
      likedAt: docReactions.createdAt,
    })
    .from(docReactions)
    .innerJoin(userTable, eq(userTable.id, docReactions.userId))
    .where(and(eq(docReactions.documentId, docId), eq(docReactions.kind, 'like')))
    .orderBy(desc(docReactions.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    image: r.image,
    likedAt: r.likedAt.toISOString(),
  }));
}

export async function getReactionState(
  db: Pick<Database, 'select'>,
  docId: string,
  userId: string | null,
): Promise<ReactionState> {
  const [countRows, likers] = await Promise.all([
    db
      .select({ kind: docReactions.kind, n: count() })
      .from(docReactions)
      .where(
        and(eq(docReactions.documentId, docId), inArray(docReactions.kind, ['like', 'dislike'])),
      )
      .groupBy(docReactions.kind),
    getDocLikers(db, docId),
  ]);
  let likeCount = 0;
  let dislikeCount = 0;
  for (const r of countRows) {
    if (r.kind === 'like') {
      likeCount = Number(r.n);
    } else if (r.kind === 'dislike') {
      dislikeCount = Number(r.n);
    }
  }
  if (userId === null) {
    return {
      likeCount,
      dislikeCount,
      myVote: null,
      bookmarked: false,
      likers,
      likerLimit: DOC_LIKER_LIMIT,
    };
  }
  const mine = await db
    .select({ kind: docReactions.kind })
    .from(docReactions)
    .where(and(eq(docReactions.documentId, docId), eq(docReactions.userId, userId)));
  const myVote = mine.some((r) => r.kind === 'like')
    ? ('like' as const)
    : mine.some((r) => r.kind === 'dislike')
      ? ('dislike' as const)
      : null;
  return {
    likeCount,
    dislikeCount,
    myVote,
    bookmarked: mine.some((r) => r.kind === 'bookmark'),
    likers,
    likerLimit: DOC_LIKER_LIMIT,
  };
}
