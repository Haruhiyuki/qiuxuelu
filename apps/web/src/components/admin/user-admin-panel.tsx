'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ROLE_LABELS, SECTION_SCOPED_ROLE, STAFF_ROLES, type StaffRole } from '@/lib/roles';
import { SANCTION_KIND_LABELS, SANCTION_KINDS } from '@/lib/sanction-kinds';
import {
  grantRole,
  recomputeTrustForUser,
  revokeRole,
  setTrustLevel,
} from '@/server/actions/admin';
import { issueSanction, revokeSanction } from '@/server/actions/sanction';

export interface RoleView {
  id: string;
  role: string;
  sectionName: string | null;
}
export interface SanctionView {
  id: string;
  kind: string;
}
export interface SectionOption {
  id: string;
  name: string;
}

export interface UserAdminPanelProps {
  userId: string;
  level: number;
  locked: boolean;
  roles: RoleView[];
  sanctions: SanctionView[];
  sections: SectionOption[];
  canGrantSection: boolean;
  canGrantGlobal: boolean;
  canSanction: boolean;
  canAdjustTrust: boolean;
}

export function UserAdminPanel(props: UserAdminPanelProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // 表单态
  const [level, setLevel] = useState(props.level);
  const [locked, setLocked] = useState(props.locked);
  const [newRole, setNewRole] = useState<StaffRole>('editor');
  const [roleSection, setRoleSection] = useState('');
  const [sanctionKind, setSanctionKind] = useState<string>('silence');
  const [sanctionDays, setSanctionDays] = useState('');
  const [sanctionReason, setSanctionReason] = useState('');

  async function run(p: Promise<{ ok: boolean; error?: string }>, okText: string) {
    setBusy(true);
    setMsg(null);
    const r = await p;
    if (r.ok) {
      setMsg(okText);
      router.refresh();
    } else {
      setMsg(r.error ?? '操作失败');
    }
    setBusy(false);
  }

  const grantableRoles = STAFF_ROLES.filter((r) =>
    SECTION_SCOPED_ROLE.has(r) ? props.canGrantSection : props.canGrantGlobal,
  );

  return (
    <div className="mt-3 flex flex-col gap-4 border-ink-100 border-t pt-3 text-sm">
      {msg !== null ? <p className="text-brand-700">{msg}</p> : null}

      {/* 信任 */}
      {props.canAdjustTrust ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink-500">信任：</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(recomputeTrustForUser(props.userId), '已重算')}
            className="rounded-sm border border-ink-300 px-2 py-1 hover:bg-paper-200"
          >
            重算
          </button>
          <select
            value={level}
            onChange={(e) => setLevel(Number(e.target.value))}
            className="rounded-sm border border-ink-300 bg-paper-50 px-1.5 py-1"
            aria-label="设定等级"
          >
            {[0, 1, 2, 3, 4].map((l) => (
              <option key={l} value={l}>
                TL{l}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-ink-600">
            <input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} />
            锁定
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(setTrustLevel(props.userId, level, locked), '已设定等级')}
            className="rounded-sm border border-ink-300 px-2 py-1 hover:bg-paper-200"
          >
            设定
          </button>
        </div>
      ) : null}

      {/* 角色 */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink-500">角色：</span>
          {props.roles.length === 0 ? <span className="text-ink-400">无</span> : null}
          {props.roles.map((r) => (
            <span
              key={r.id}
              className="inline-flex items-center gap-1 rounded-sm bg-paper-200 px-2 py-0.5"
            >
              {ROLE_LABELS[r.role as StaffRole] ?? r.role}
              {r.sectionName ? `·${r.sectionName}` : ''}
              {props.canGrantSection || props.canGrantGlobal ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(revokeRole(r.id), '已撤销')}
                  className="text-ink-400 hover:text-accent-700"
                >
                  ×
                </button>
              ) : null}
            </span>
          ))}
        </div>
        {grantableRoles.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as StaffRole)}
              className="rounded-sm border border-ink-300 bg-paper-50 px-1.5 py-1"
              aria-label="任命角色"
            >
              {grantableRoles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            {SECTION_SCOPED_ROLE.has(newRole) ? (
              <select
                value={roleSection}
                onChange={(e) => setRoleSection(e.target.value)}
                className="rounded-sm border border-ink-300 bg-paper-50 px-1.5 py-1"
                aria-label="板块"
              >
                <option value="">选择板块…</option>
                {props.sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(
                  grantRole(
                    props.userId,
                    newRole,
                    SECTION_SCOPED_ROLE.has(newRole) ? roleSection : null,
                  ),
                  '已任命',
                )
              }
              className="rounded-sm border border-ink-300 px-2 py-1 hover:bg-paper-200"
            >
              任命
            </button>
          </div>
        ) : null}
      </div>

      {/* 制裁 */}
      {props.canSanction ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-ink-500">制裁：</span>
            {props.sanctions.length === 0 ? <span className="text-ink-400">无</span> : null}
            {props.sanctions.map((s) => (
              <span
                key={s.id}
                className="inline-flex items-center gap-1 rounded-sm bg-accent-100 px-2 py-0.5 text-accent-800"
              >
                {SANCTION_KIND_LABELS[s.kind as keyof typeof SANCTION_KIND_LABELS] ?? s.kind}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(revokeSanction(s.id), '已解除')}
                  className="hover:text-accent-900"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={sanctionKind}
              onChange={(e) => setSanctionKind(e.target.value)}
              className="rounded-sm border border-ink-300 bg-paper-50 px-1.5 py-1"
              aria-label="制裁种类"
            >
              {SANCTION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {SANCTION_KIND_LABELS[k]}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              value={sanctionDays}
              onChange={(e) => setSanctionDays(e.target.value)}
              placeholder="天数(空=永久)"
              className="w-28 rounded-sm border border-ink-300 bg-paper-50 px-1.5 py-1"
            />
            <input
              type="text"
              value={sanctionReason}
              onChange={(e) => setSanctionReason(e.target.value)}
              placeholder="理由（必填）"
              className="w-40 rounded-sm border border-ink-300 bg-paper-50 px-1.5 py-1"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(
                  issueSanction(
                    props.userId,
                    sanctionKind,
                    sanctionReason,
                    sanctionDays === '' ? null : Number(sanctionDays),
                  ),
                  '已签发制裁',
                )
              }
              className="rounded-sm bg-accent-700 px-2 py-1 font-medium text-paper-50 hover:bg-accent-800"
            >
              签发
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
