// 通知邮件：扫描 notifications（emailed_at 为空且属高信号种类），按用户偏好发邮件后置位。
// 与业务事务解耦（不在事务内发信），天然批处理、可重放、幂等（emailed_at）。
import type { Database } from '@harublog/db';
import { basicEmail, sendEmail } from '@harublog/mailer';
import { sql } from 'drizzle-orm';

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const BATCH = 50;

// 只对高信号、低频、可行动的通知发邮件（评论/回复/被编辑等高频项不发，免打扰）
const EMAIL_KINDS = [
  'publish_approved',
  'publish_rejected',
  'patrol_reverted',
  'suggestion_received',
  'suggestion_merged',
  'suggestion_rejected',
  'suggestion_changes',
  'new_post',
  'review_pending',
] as const;

const SUBJECTS: Record<string, string> = {
  publish_approved: '你的文章已通过审核并发布',
  publish_rejected: '你的发布申请未通过审核',
  patrol_reverted: '你的协作编辑被巡查回退',
  suggestion_received: '有人向你的文章提交了编辑建议',
  suggestion_merged: '你的编辑建议已被采纳',
  suggestion_rejected: '你的编辑建议未被采纳',
  suggestion_changes: '你的编辑建议被要求修改',
  new_post: '你订阅的板块有新文章',
  review_pending: '有新的待办事项待处理',
};

interface Payload {
  slug?: string;
  docId?: string;
  title?: string;
  suggestionId?: string;
  sectionName?: string;
  unsubToken?: string;
  // review_pending：标记是哪个审校队列（决定跳转的后台页与正文）
  queue?: string;
}

// review_pending 各队列 → 后台处理页
function adminLinkForQueue(queue: string | undefined): string {
  if (queue === 'suggestion') {
    return `${APP_URL}/admin/suggestions`;
  }
  if (queue === 'flag') {
    return `${APP_URL}/admin/flags`;
  }
  // new_document / first_post（发布审批）
  return `${APP_URL}/admin/review`;
}

function linkFor(kind: string, p: Payload): string {
  if (kind === 'review_pending') {
    return adminLinkForQueue(p.queue);
  }
  if (kind.startsWith('suggestion_') && p.suggestionId) {
    return `${APP_URL}/suggestions/${p.suggestionId}`;
  }
  if (kind === 'publish_rejected' && p.docId) {
    return `${APP_URL}/write/${p.docId}`;
  }
  if (p.slug) {
    return `${APP_URL}/a/${p.slug}`;
  }
  return `${APP_URL}/notifications`;
}

// review_pending 的正文（按队列定制）
function reviewPendingBody(p: Payload): string {
  const title = p.title ?? '';
  if (p.queue === 'suggestion') {
    return `有一条修订申请待审核${title ? `（《${title}》）` : ''}，请前往后台处理。`;
  }
  if (p.queue === 'flag') {
    return '有一条举报待复核，请前往后台处理。';
  }
  return `有一篇新文章${title ? `《${title}》` : ''}待审批，请前往后台处理。`;
}

interface Row {
  id: string;
  kind: string;
  payload: Payload | null;
  email: string;
  email_notifications: boolean;
}

/** 发一批通知邮件，返回处理条数。 */
export async function drainNotificationEmails(db: Database): Promise<number> {
  const inList = EMAIL_KINDS.map((k) => `'${k}'`).join(',');
  // 只发近 7 天内产生的，避免首次上线把历史通知一次性补发
  const rows = (await db.execute(sql`
    select n.id, n.kind, n.payload, u.email, u."emailNotifications" as email_notifications
    from notifications n
    join "user" u on u.id = n.user_id
    where n.emailed_at is null
      and n.created_at > now() - interval '7 days'
      and n.kind in (${sql.raw(inList)})
    order by n.id asc
    limit ${BATCH}
    for update skip locked
  `)) as unknown as Row[];

  for (const row of rows) {
    try {
      if (row.email_notifications && row.email) {
        const p = row.payload ?? {};
        const title = p.title ?? '';
        const subject = SUBJECTS[row.kind] ?? '求学路有新动态';
        let body: string;
        if (row.kind === 'review_pending') {
          body = reviewPendingBody(p);
        } else if (row.kind === 'new_post') {
          const sec = p.sectionName ?? '';
          body = `你订阅的板块${sec ? `《${sec}》` : ''}发布了新文章《${title}》。`;
          if (p.unsubToken) {
            body += `\n\n不想再收到此板块更新？一键退订：${APP_URL}/api/unsubscribe?token=${p.unsubToken}`;
          }
        } else {
          body = title.length > 0 ? `关于《${title}》：${subject}。` : `${subject}。`;
        }
        const mail = basicEmail(subject, body, {
          label: '查看详情',
          url: linkFor(row.kind, p),
        });
        await sendEmail({ to: row.email, subject, ...mail });
      }
      // 无论是否发送（偏好关/无邮箱）都置位，避免反复扫描
      await db.execute(sql`update notifications set emailed_at = now() where id = ${row.id}`);
    } catch (err) {
      console.error(`[worker] 通知邮件 ${row.id}(${row.kind}) 发送失败：`, err);
    }
  }
  return rows.length;
}
