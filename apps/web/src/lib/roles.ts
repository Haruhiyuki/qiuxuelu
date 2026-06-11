// 角色标签与作用域规则（与 db role_grants.role / domain Role 一致）。
export const STAFF_ROLES = ['editor', 'section_mod', 'admin', 'superadmin'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ROLE_LABELS: Record<StaffRole, string> = {
  editor: '编辑',
  section_mod: '板块管理员',
  admin: '管理员',
  superadmin: '超级管理员',
};

/** 板块域角色必须带 section_id；全局角色 section_id 恒为 null。 */
export const SECTION_SCOPED_ROLE = new Set<StaffRole>(['editor', 'section_mod']);
