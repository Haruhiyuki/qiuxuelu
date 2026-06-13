// 站点公告读取（非 Server Action）：近闻页、近闻详情、首页公告栏、管理列表。
import { announcements, type Database, user as userTable } from '@harublog/db';
import { and, desc, eq } from 'drizzle-orm';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AnnouncementView {
  id: string;
  title: string;
  body: string;
  level: 'info' | 'notice';
  status: string;
  pinned: boolean;
  linkHref: string | null;
  linkLabel: string | null;
  authorName: string | null;
  publishedAt: Date;
}

const baseSelect = {
  id: announcements.id,
  title: announcements.title,
  body: announcements.body,
  level: announcements.level,
  status: announcements.status,
  pinned: announcements.pinned,
  linkHref: announcements.linkHref,
  linkLabel: announcements.linkLabel,
  authorName: userTable.name,
  publishedAt: announcements.publishedAt,
};

function toView(r: {
  id: string;
  title: string;
  body: string;
  level: string;
  status: string;
  pinned: boolean;
  linkHref: string | null;
  linkLabel: string | null;
  authorName: string | null;
  publishedAt: Date;
}): AnnouncementView {
  return { ...r, level: (r.level === 'notice' ? 'notice' : 'info') as 'info' | 'notice' };
}

/** 近闻页：已发布公告，按发布时间倒序。 */
export async function listPublishedAnnouncements(
  db: Pick<Database, 'select'>,
  limit = 50,
): Promise<AnnouncementView[]> {
  const rows = await db
    .select(baseSelect)
    .from(announcements)
    .leftJoin(userTable, eq(userTable.id, announcements.authorId))
    .where(eq(announcements.status, 'published'))
    .orderBy(desc(announcements.publishedAt))
    .limit(limit);
  return rows.map(toView);
}

/** 近闻详情：单条已发布公告（非法 id 或非已发布 → null，由页面转 404）。 */
export async function getPublishedAnnouncement(
  db: Pick<Database, 'select'>,
  id: string,
): Promise<AnnouncementView | null> {
  if (!UUID_RE.test(id)) {
    return null; // 防 uuid 列收到非法串报错
  }
  const rows = await db
    .select(baseSelect)
    .from(announcements)
    .leftJoin(userTable, eq(userTable.id, announcements.authorId))
    .where(and(eq(announcements.id, id), eq(announcements.status, 'published')))
    .limit(1);
  return rows[0] !== undefined ? toView(rows[0]) : null;
}

/** 首页公告栏：最新的「已发布 + 置顶」公告（无则 null）。 */
export async function getHomepageBanner(
  db: Pick<Database, 'select'>,
): Promise<AnnouncementView | null> {
  const rows = await db
    .select(baseSelect)
    .from(announcements)
    .leftJoin(userTable, eq(userTable.id, announcements.authorId))
    .where(and(eq(announcements.status, 'published'), eq(announcements.pinned, true)))
    .orderBy(desc(announcements.publishedAt))
    .limit(1);
  return rows[0] !== undefined ? toView(rows[0]) : null;
}

/** 管理列表：全部状态，最近优先。 */
export async function listAllAnnouncements(
  db: Pick<Database, 'select'>,
): Promise<AnnouncementView[]> {
  const rows = await db
    .select(baseSelect)
    .from(announcements)
    .leftJoin(userTable, eq(userTable.id, announcements.authorId))
    .orderBy(desc(announcements.publishedAt))
    .limit(100);
  return rows.map(toView);
}
