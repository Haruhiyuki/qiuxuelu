import { describe, expect, it } from 'vitest';
import { assembleActor } from '../../src/authz/snapshot';

const NOW = new Date('2026-06-10T00:00:00Z');

describe('assembleActor —— db 行 → Actor 快照', () => {
  it('过滤已过期的角色授予与制裁，保留有效项', () => {
    const actor = assembleActor(
      {
        user: { id: 'u1', status: 'active', trustLevel: 3 },
        roleGrants: [
          { role: 'editor', sectionId: 's1', expiresAt: new Date('2026-01-01T00:00:00Z') },
          { role: 'section_mod', sectionId: 's2', expiresAt: new Date('2027-01-01T00:00:00Z') },
          { role: 'admin', sectionId: null, expiresAt: null },
        ],
        sanctions: [
          { kind: 'silence', sectionId: null, endsAt: new Date('2026-01-01T00:00:00Z') },
          { kind: 'no_edit', sectionId: 's1', endsAt: null },
        ],
      },
      NOW,
    );
    expect(actor.roles).toEqual([
      { role: 'section_mod', sectionId: 's2' },
      { role: 'admin', sectionId: null },
    ]);
    expect(actor.sanctions).toEqual([{ kind: 'no_edit', sectionId: 's1', endsAt: null }]);
    expect(actor.trustLevel).toBe(3);
  });

  it('非法枚举值抛错（暴露 db 与 domain 漂移）', () => {
    expect(() =>
      assembleActor(
        { user: { id: 'u1', status: 'banned', trustLevel: 0 }, roleGrants: [], sanctions: [] },
        NOW,
      ),
    ).toThrow('user.status');
    expect(() =>
      assembleActor(
        { user: { id: 'u1', status: 'active', trustLevel: 7 }, roleGrants: [], sanctions: [] },
        NOW,
      ),
    ).toThrow('user.trustLevel');
    expect(() =>
      assembleActor(
        {
          user: { id: 'u1', status: 'active', trustLevel: 0 },
          roleGrants: [{ role: 'moderator', sectionId: null, expiresAt: null }],
          sanctions: [],
        },
        NOW,
      ),
    ).toThrow('roleGrant.role');
  });
});
