import { auditLog, comments, documents, getDb, sections, user as userTable } from '@harublog/db';
import { desc, eq, inArray } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AdminForbidden } from '@/components/admin/admin-forbidden';
import { AdminPageHeader } from '@/components/admin/admin-page-header';
import { Pagination } from '@/components/pagination';
import { FLAG_REASON_LABELS } from '@/lib/flag-reasons';
import { formatDateTime } from '@/lib/format';
import { REJECT_REASON_LABELS } from '@/lib/review-reasons';
import { ROLE_LABELS } from '@/lib/roles';
import { SANCTION_KIND_LABELS } from '@/lib/sanction-kinds';
import { getSession } from '@/lib/session';
import { loadActor } from '@/server/actors';

const PAGE_SIZE = 50;

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '审计日志', robots: { index: false } };

// 复用既有中文映射（按 string 索引，未知值回落原码）
const ROLE = ROLE_LABELS as Record<string, string>;
const SANCTION = SANCTION_KIND_LABELS as Record<string, string>;
const REJECT = REJECT_REASON_LABELS as Record<string, string>;
const FLAG = FLAG_REASON_LABELS as Record<string, string>;

// 高危操作的中文动作名（审计可读化）
const ACTION_LABELS: Record<string, string> = {
  'doc.create': '创建文章',
  'doc.commit_revision': '提交修订',
  'doc.request_publish': '申请发布',
  'doc.collab_edit': '协作直编',
  'doc.rollback': '回滚',
  'doc.protect': '设编辑策略',
  'doc.feature': '精选设置',
  'doc.publicize': '设为公共页',
  'doc.unpublish': '撤下文章',
  'publish_request.approve': '通过发布',
  'publish_request.reject': '驳回发布',
  'doc.publish_direct': '直接发布',
  'comment.hide': '隐藏评论',
  'comment.ai_release': '放行 AI 拦截评论',
  'comment.ai_reject': '删除 AI 拦截评论',
  'feedback.handle': '处理编辑建议',
  'flag.create': '举报',
  'flag.uphold': '采纳举报',
  'flag.dismiss': '驳回举报',
  'sanction.issue': '签发制裁',
  'sanction.revoke': '解除制裁',
  'role.grant': '任命角色',
  'role.revoke': '撤销角色',
  'trust.recompute': '重算信任',
  'trust.set_level': '设定信任等级',
  'patrol.approve': '巡查通过',
  'patrol.revert': '巡查回退',
  'suggestion.create': '提交修订申请',
  'suggestion.merge': '合入修订申请',
  'suggestion.reject': '驳回修订申请',
  'suggestion.request_changes': '要求修改',
  'suggestion.withdraw': '撤回修订申请',
  'announcement.create': '发布公告',
  'announcement.update': '修改公告',
  'announcement.status': '调整公告状态',
  'user.consent': '同意条款',
  'user.self_delete': '注销账号',
};

// 动作分类（治理可读化）：默认只看「重点」，把高频日常动作折进「全部」消除噪音。
const POWER = [
  'role.grant',
  'role.revoke',
  'trust.set_level',
  'trust.recompute',
  'sanction.issue',
  'sanction.revoke',
  'user.self_delete',
];
const MOD = [
  'flag.uphold',
  'flag.dismiss',
  'comment.hide',
  'comment.ai_release',
  'comment.ai_reject',
  'doc.rollback',
  'doc.protect',
  'doc.feature',
  'doc.publicize',
  'doc.unpublish',
  'patrol.revert',
];
const REVIEW = [
  'publish_request.approve',
  'publish_request.reject',
  'doc.publish_direct',
  'suggestion.merge',
  'suggestion.reject',
  'suggestion.request_changes',
  'announcement.create',
  'announcement.status',
];
const KEY = [...POWER, ...MOD, ...REVIEW];

const FILTERS: Record<string, { label: string; actions: string[] | null }> = {
  key: { label: '重点', actions: KEY },
  power: { label: '权力与制裁', actions: POWER },
  mod: { label: '内容裁决', actions: MOD },
  review: { label: '发布与审校', actions: REVIEW },
  all: { label: '全部', actions: null },
};

// 视觉分级：负向（处罚/撤销/回退/驳回）标红，正向（任命/通过/合入/放行）标绿，其余中性。
const NEGATIVE = new Set([
  'sanction.issue',
  'role.revoke',
  'publish_request.reject',
  'suggestion.reject',
  'suggestion.request_changes',
  'comment.hide',
  'comment.ai_reject',
  'flag.uphold',
  'patrol.revert',
  'doc.rollback',
  'doc.unpublish',
  'user.self_delete',
]);
const POSITIVE = new Set([
  'role.grant',
  'publish_request.approve',
  'doc.publish_direct',
  'suggestion.merge',
  'comment.ai_release',
  'doc.publicize',
  'sanction.revoke',
]);

function toneClass(action: string): string {
  if (NEGATIVE.has(action)) return 'text-accent-700';
  if (POSITIVE.has(action)) return 'text-moss-700';
  return 'text-brand-700';
}

function pick(d: Record<string, unknown>, k: string): string | undefined {
  const v = d[k];
  return v === null || v === undefined ? undefined : String(v);
}

interface ResolveMaps {
  users: Map<string, string>;
  docs: Map<string, { title: string; slug: string; status: string }>;
  commentDoc: Map<string, string>;
  sections: Map<string, string>;
}

function docTarget(id: string | undefined, maps: ResolveMaps): { label: string; href?: string } {
  if (!id) return { label: '（文档不详）' };
  const doc = maps.docs.get(id);
  if (!doc) return { label: '已删除文档' };
  return {
    label: `《${doc.title}》`,
    href: doc.status === 'published' ? `/a/${doc.slug}` : undefined,
  };
}

// 把一条审计的主体解析成「可读标签 + 可点链接」，取代原来的 `type:uuid前8位`
function targetOf(
  subjectType: string | null,
  subjectId: string | null,
  d: Record<string, unknown>,
  maps: ResolveMaps,
): { label: string; href?: string } {
  const sid = subjectId ?? '';
  switch (subjectType) {
    case 'user': {
      const name = maps.users.get(sid);
      return { label: name ?? '已注销用户', href: name ? `/u/${sid}` : undefined };
    }
    case 'document':
      return docTarget(sid, maps);
    case 'revision':
    case 'publish_request':
      return docTarget(pick(d, 'documentId'), maps);
    case 'comment': {
      const t = docTarget(maps.commentDoc.get(sid), maps);
      return { label: `${t.label} 的评论`, href: t.href };
    }
    case 'suggestion':
      return { label: '修订申请', href: `/suggestions/${sid}` };
    case 'feedback':
      return { label: '编辑建议' };
    case 'announcement': {
      const title = pick(d, 'title');
      return { label: title ? `公告《${title}》` : '公告', href: `/news/${sid}` };
    }
    default:
      return { label: subjectType ?? '—' };
  }
}

// 把 detail 渲染成动作专属的「具体说明」短语（审计的有效信息核心）
function extraOf(action: string, d: Record<string, unknown>, maps: ResolveMaps): string | null {
  const join = (...parts: (string | null | undefined)[]) =>
    parts.filter((p): p is string => Boolean(p)).join(' · ') || null;
  switch (action) {
    case 'role.grant': {
      const role = pick(d, 'role');
      const sid = pick(d, 'sectionId');
      const scope = sid ? (maps.sections.get(sid) ?? '某板块') : '全站';
      return `授予「${role ? (ROLE[role] ?? role) : '角色'}」· ${scope}`;
    }
    case 'role.revoke': {
      const role = pick(d, 'role');
      return `撤销「${role ? (ROLE[role] ?? role) : '角色'}」`;
    }
    case 'trust.set_level':
      return `信任等级 → TL${pick(d, 'level') ?? '?'}${d.locked === true ? '（锁定）' : ''}`;
    case 'trust.recompute': {
      const from = pick(d, 'from');
      const to = pick(d, 'to');
      return from !== undefined && to !== undefined ? `信任等级 TL${from} → TL${to}` : '重算信任';
    }
    case 'sanction.issue': {
      const kind = pick(d, 'kind');
      const endsAt = pick(d, 'endsAt');
      const until = endsAt ? `至 ${formatDateTime(new Date(endsAt))}` : '永久';
      return join(
        kind ? (SANCTION[kind] ?? kind) : '制裁',
        until,
        pick(d, 'reason') && `理由：${pick(d, 'reason')}`,
      );
    }
    case 'sanction.revoke':
      return '解除制裁';
    case 'user.self_delete':
      return '用户自助注销（已匿名化）';
    case 'publish_request.reject': {
      const rc = pick(d, 'reasonCode');
      return rc ? `理由：${REJECT[rc] ?? rc}` : null;
    }
    case 'suggestion.reject': {
      const rc = pick(d, 'reasonCode');
      return join(rc && `理由：${REJECT[rc] ?? rc}`, pick(d, 'note') && `备注：${pick(d, 'note')}`);
    }
    case 'suggestion.request_changes':
      return pick(d, 'note') ? `备注：${pick(d, 'note')}` : null;
    case 'comment.hide':
      return pick(d, 'reason') ? `理由：${pick(d, 'reason')}` : null;
    case 'flag.uphold':
    case 'flag.dismiss':
      return pick(d, 'note') ? `备注：${pick(d, 'note')}` : null;
    case 'flag.create': {
      const rc = pick(d, 'reasonCode');
      const w = pick(d, 'weight');
      return rc ? `${FLAG[rc] ?? rc}${w ? `（权重 ${w}）` : ''}` : null;
    }
    case 'doc.protect':
      return pick(d, 'editPolicy')
        ? `编辑策略 → ${pick(d, 'editPolicy') === 'locked' ? '锁定' : '开放'}`
        : null;
    case 'doc.feature':
      return d.featured === true ? '设为精选' : '取消精选';
    case 'doc.publicize':
      return pick(d, 'reason') ? `原因：${pick(d, 'reason')}` : '升级为公共页';
    case 'patrol.revert':
      return '回退至上一修订';
    case 'doc.rollback':
      return pick(d, 'targetSeq') !== undefined ? `回退至修订 #${pick(d, 'targetSeq')}` : '回退';
    case 'announcement.create':
      return join(d.pinned === true ? '置顶' : null, pick(d, 'level'));
    case 'announcement.status':
      return pick(d, 'status') ? `状态 → ${pick(d, 'status')}` : null;
    case 'feedback.handle':
      return pick(d, 'status') ? `状态 → ${pick(d, 'status')}` : null;
    default:
      return null;
  }
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; cat?: string }>;
}) {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  const { page: pageParam, cat: catParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const cat = catParam && catParam in FILTERS ? catParam : 'key';
  const actor = await loadActor(session.user.id);
  // 审计查看：管理员及以上
  const isAdmin = actor?.roles.some((r) => r.role === 'admin' || r.role === 'superadmin') ?? false;
  if (!isAdmin) {
    return <AdminForbidden reason="审计日志仅管理员可查看。" />;
  }

  const db = getDb();
  const actions = FILTERS[cat]?.actions ?? null;
  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      subjectType: auditLog.subjectType,
      subjectId: auditLog.subjectId,
      detail: auditLog.detail,
      createdAt: auditLog.createdAt,
      actorName: userTable.name,
    })
    .from(auditLog)
    .leftJoin(userTable, eq(userTable.id, auditLog.actorId))
    .where(actions ? inArray(auditLog.action, actions) : undefined)
    .orderBy(desc(auditLog.id))
    .limit(PAGE_SIZE + 1)
    .offset((page - 1) * PAGE_SIZE);
  const hasNext = rows.length > PAGE_SIZE;
  const items = rows.slice(0, PAGE_SIZE);

  // 主体批量解析：先收集各类 id，再分表回查（每页 ≤50 条，固定几次 inArray）
  const userIds = new Set<string>();
  const docIds = new Set<string>();
  const commentIds = new Set<string>();
  const sectionIds = new Set<string>();
  for (const r of items) {
    const d = (r.detail ?? {}) as Record<string, unknown>;
    if (r.subjectType === 'user' && r.subjectId) userIds.add(r.subjectId);
    if (r.subjectType === 'document' && r.subjectId) docIds.add(r.subjectId);
    if (r.subjectType === 'comment' && r.subjectId) commentIds.add(r.subjectId);
    const docId = pick(d, 'documentId');
    if (docId) docIds.add(docId);
    const sid = pick(d, 'sectionId');
    if (sid) sectionIds.add(sid);
  }

  const commentDoc = new Map<string, string>();
  if (commentIds.size > 0) {
    const cs = await db
      .select({ id: comments.id, documentId: comments.documentId })
      .from(comments)
      .where(inArray(comments.id, [...commentIds]));
    for (const c of cs) {
      commentDoc.set(c.id, c.documentId);
      docIds.add(c.documentId);
    }
  }

  const docs = new Map<string, { title: string; slug: string; status: string }>();
  if (docIds.size > 0) {
    const ds = await db
      .select({
        id: documents.id,
        title: documents.title,
        slug: documents.slug,
        status: documents.status,
      })
      .from(documents)
      .where(inArray(documents.id, [...docIds]));
    for (const doc of ds)
      docs.set(doc.id, { title: doc.title, slug: doc.slug, status: doc.status });
  }

  const users = new Map<string, string>();
  if (userIds.size > 0) {
    const us = await db
      .select({ id: userTable.id, name: userTable.name })
      .from(userTable)
      .where(inArray(userTable.id, [...userIds]));
    for (const u of us) users.set(u.id, u.name);
  }

  const sectionMap = new Map<string, string>();
  if (sectionIds.size > 0) {
    const ss = await db
      .select({ id: sections.id, name: sections.name })
      .from(sections)
      .where(inArray(sections.id, [...sectionIds]));
    for (const s of ss) sectionMap.set(s.id, s.name);
  }

  const maps: ResolveMaps = { users, docs, commentDoc, sections: sectionMap };

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <AdminPageHeader
        title="审计日志"
        description="高危操作的不可篡改凭证。默认只看「重点」治理动作；切到「全部」可见创建/提交/举报等日常记录。"
      />

      <nav aria-label="按类别筛选" className="mt-5 flex flex-wrap gap-1.5">
        {Object.entries(FILTERS).map(([key, f]) => {
          const active = key === cat;
          return (
            <Link
              key={key}
              href={key === 'key' ? '/admin/audit' : `/admin/audit?cat=${key}`}
              aria-current={active ? 'true' : undefined}
              className={
                active
                  ? 'rounded-full bg-brand-100 px-3 py-1 font-medium text-brand-800 text-sm'
                  : 'rounded-full px-3 py-1 text-ink-500 text-sm transition-colors hover:bg-paper-200 hover:text-ink-800'
              }
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      {items.length === 0 ? (
        <p className="py-10 text-ink-500 text-sm">该类别下暂无审计记录。</p>
      ) : (
        <ul className="mt-4 divide-y divide-ink-100">
          {items.map((r) => {
            const d = (r.detail ?? {}) as Record<string, unknown>;
            const target = targetOf(r.subjectType, r.subjectId, d, maps);
            const extra = extraOf(r.action, d, maps);
            return (
              <li
                key={r.id}
                className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 py-2.5 text-sm"
              >
                <time
                  dateTime={r.createdAt.toISOString()}
                  className="shrink-0 font-mono text-ink-400 text-xs tabular-nums"
                >
                  {formatDateTime(r.createdAt)}
                </time>
                <span className="font-medium text-ink-800">{r.actorName ?? '系统'}</span>
                <span
                  className={toneClass(r.action)}
                  title={`${r.action}${r.subjectId ? ` · ${r.subjectType}:${r.subjectId}` : ''}`}
                >
                  {ACTION_LABELS[r.action] ?? r.action}
                </span>
                {target.href ? (
                  <Link
                    href={target.href}
                    className="text-ink-700 underline-offset-2 hover:text-brand-700 hover:underline"
                  >
                    {target.label}
                  </Link>
                ) : (
                  <span className="text-ink-700">{target.label}</span>
                )}
                {extra ? <span className="text-ink-500">· {extra}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
      <Pagination
        page={page}
        hasNext={hasNext}
        basePath="/admin/audit"
        params={cat === 'key' ? undefined : { cat }}
      />
    </div>
  );
}
