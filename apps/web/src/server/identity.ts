// 提及解析（服务端）：候选串 → user.id。
// 规则：对候选的每个前缀（长→短）先匹配现役名、再匹配改名历史（最近让渡优先）；
// 现役名永远压过历史名（旧名被新用户注册后归新用户，与 slug 让渡同语义）。
import { type Database, userNameHistory, user as userTable } from '@harublog/db';
import { desc, inArray, sql } from 'drizzle-orm';
import { prefixesOf } from '@/lib/identity';

type ReadLike = Pick<Database, 'select'>;

export interface ResolvedMention {
  userId: string;
  /** 实际命中的名字（候选串的前缀） */
  name: string;
}

/** 解析单个候选串（/u/by 路由用）。 */
export async function resolveMentionCandidate(
  db: ReadLike,
  candidate: string,
): Promise<ResolvedMention | null> {
  const map = await resolveMentionCandidates(db, [candidate]);
  return map.get(candidate) ?? null;
}

/** 批量解析候选串（通知用）：返回 候选串 → 命中。两次查询覆盖全部候选的全部前缀。 */
export async function resolveMentionCandidates(
  db: ReadLike,
  candidates: string[],
): Promise<Map<string, ResolvedMention>> {
  const out = new Map<string, ResolvedMention>();
  if (candidates.length === 0) {
    return out;
  }
  const allPrefixes = new Set<string>();
  for (const c of candidates) {
    for (const p of prefixesOf(c)) {
      allPrefixes.add(p.toLowerCase());
    }
  }
  const prefixList = [...allPrefixes];

  // 现役名：lower(name) 精确命中
  const current = await db
    .select({ id: userTable.id, name: userTable.name })
    .from(userTable)
    .where(inArray(sql`lower(${userTable.name})`, prefixList));
  const currentByLower = new Map<string, ResolvedMention>();
  for (const r of current) {
    currentByLower.set(r.name.toLowerCase(), { userId: r.id, name: r.name });
  }

  // 历史名：同名多次让渡取最近一次（按 changedAt 降序首条）
  const history = await db
    .select({
      userId: userNameHistory.userId,
      oldName: userNameHistory.oldName,
    })
    .from(userNameHistory)
    .where(inArray(sql`lower(${userNameHistory.oldName})`, prefixList))
    .orderBy(desc(userNameHistory.changedAt));
  const historyByLower = new Map<string, ResolvedMention>();
  for (const r of history) {
    const key = r.oldName.toLowerCase();
    if (!historyByLower.has(key)) {
      historyByLower.set(key, { userId: r.userId, name: r.oldName });
    }
  }

  for (const c of candidates) {
    for (const p of prefixesOf(c)) {
      const key = p.toLowerCase();
      const hit = currentByLower.get(key) ?? historyByLower.get(key);
      if (hit !== undefined) {
        out.set(c, hit);
        break;
      }
    }
  }
  return out;
}
