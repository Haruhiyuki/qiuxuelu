import { describe, expect, it } from 'vitest';
import { can } from '../../src/authz/can';
import type { Actor, DocCtx, ResourceCtx } from '../../src/authz/types';

const NOW = new Date('2026-06-10T00:00:00Z');

function makeActor(overrides: Partial<Actor> = {}): Actor {
  return {
    id: 'u1',
    status: 'active',
    trustLevel: 0,
    roles: [],
    sanctions: [],
    ...overrides,
  };
}

function makeDoc(overrides: Partial<DocCtx> = {}): DocCtx {
  return {
    id: 'd1',
    ownerId: 'someone-else',
    editPolicy: 'open',
    status: 'published',
    ...overrides,
  };
}

function inSection(sectionId: string, doc?: DocCtx): ResourceCtx {
  return doc === undefined ? { sectionId } : { sectionId, doc };
}

describe('can() —— 红线：信任线永远拿不到角色专属能力', () => {
  it('TL4 申请 doc.publish 被拒，拒因为 role_required 且列出可授予角色', () => {
    const d = can(makeActor({ trustLevel: 4 }), 'doc.publish', {}, NOW);
    expect(d).toEqual({
      allow: false,
      reason: { kind: 'role_required', roles: ['editor', 'section_mod', 'admin', 'superadmin'] },
    });
  });

  it('TL4 申请 flag.review 被拒（红线含 flag.review）', () => {
    const d = can(makeActor({ trustLevel: 4 }), 'flag.review', {}, NOW);
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason.kind).toBe('role_required');
  });

  it('TL4 文档作者申请 doc.publish 仍被拒——owner 特例不覆盖红线', () => {
    const doc = makeDoc({ ownerId: 'u1' });
    const d = can(makeActor({ trustLevel: 4 }), 'doc.publish', { doc }, NOW);
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason.kind).toBe('role_required');
  });
});

describe('can() —— 角色线与板块作用域', () => {
  const sectionEditor = makeActor({ roles: [{ role: 'editor', sectionId: 's1' }] });

  it('板块 editor 在本板块 doc.publish 命中角色线', () => {
    expect(can(sectionEditor, 'doc.publish', inSection('s1'), NOW)).toEqual({
      allow: true,
      via: 'role',
      obligations: [],
    });
  });

  it('板块 editor 跨板块 doc.publish 不命中作用域，落入红线拒因', () => {
    const d = can(sectionEditor, 'doc.publish', inSection('s2'), NOW);
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason.kind).toBe('role_required');
  });

  it('资源无板块上下文时板块域角色不命中', () => {
    const d = can(sectionEditor, 'doc.publish', {}, NOW);
    expect(d.allow).toBe(false);
  });

  it('全局 admin 在任意板块覆盖 doc.unpublish', () => {
    const admin = makeActor({ roles: [{ role: 'admin', sectionId: null }] });
    const d = can(admin, 'doc.unpublish', inSection('s9'), NOW);
    expect(d).toEqual({ allow: true, via: 'role', obligations: [] });
  });

  it('system.config 仅 superadmin：admin 被拒且拒因只列 superadmin', () => {
    const admin = makeActor({ roles: [{ role: 'admin', sectionId: null }] });
    expect(can(admin, 'system.config', {}, NOW)).toEqual({
      allow: false,
      reason: { kind: 'role_required', roles: ['superadmin'] },
    });
    const superadmin = makeActor({ roles: [{ role: 'superadmin', sectionId: null }] });
    expect(can(superadmin, 'system.config', {}, NOW).allow).toBe(true);
  });

  it('locked 文档角色线仍可直编（locked = 仅角色线）', () => {
    const doc = makeDoc({ editPolicy: 'locked' });
    const d = can(sectionEditor, 'doc.edit_direct', inSection('s1', doc), NOW);
    expect(d).toEqual({ allow: true, via: 'role', obligations: [] });
  });
});

describe('can() —— 制裁一票否决', () => {
  it('全局禁言封锁 comment.create，until 透传', () => {
    const until = new Date('2026-07-01T00:00:00Z');
    const muted = makeActor({
      trustLevel: 2,
      sanctions: [{ kind: 'silence', sectionId: null, endsAt: until }],
    });
    expect(can(muted, 'comment.create', {}, NOW)).toEqual({
      allow: false,
      reason: { kind: 'sanction', until },
    });
  });

  it('板块域禁言只在该板块生效', () => {
    const muted = makeActor({
      trustLevel: 2,
      sanctions: [{ kind: 'silence', sectionId: 's1', endsAt: null }],
    });
    const inS1 = can(muted, 'comment.create', inSection('s1'), NOW);
    expect(inS1).toEqual({ allow: false, reason: { kind: 'sanction', until: null } });
    expect(can(muted, 'comment.create', inSection('s2'), NOW).allow).toBe(true);
  });

  it('已过期制裁不生效', () => {
    const expired = makeActor({
      trustLevel: 2,
      sanctions: [{ kind: 'silence', sectionId: null, endsAt: new Date('2026-01-01T00:00:00Z') }],
    });
    expect(can(expired, 'comment.create', {}, NOW).allow).toBe(true);
  });

  it('制裁优先于角色线：被封禁的 admin 也无法 doc.publish', () => {
    const bannedAdmin = makeActor({
      roles: [{ role: 'admin', sectionId: null }],
      sanctions: [{ kind: 'suspend', sectionId: null, endsAt: null }],
    });
    const d = can(bannedAdmin, 'doc.publish', {}, NOW);
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.reason.kind).toBe('sanction');
  });

  it('ban 不封锁 content.read（阅读权不剥夺）', () => {
    const banned = makeActor({ sanctions: [{ kind: 'suspend', sectionId: null, endsAt: null }] });
    expect(can(banned, 'content.read', {}, NOW).allow).toBe(true);
  });

  it('no_edit 封锁创建文档但不封锁建议与评论；no_suggest 只封锁建议', () => {
    const editBanned = makeActor({
      trustLevel: 3,
      sanctions: [{ kind: 'no_edit', sectionId: null, endsAt: null }],
    });
    expect(can(editBanned, 'doc.create', {}, NOW).allow).toBe(false);
    expect(can(editBanned, 'suggestion.create', {}, NOW).allow).toBe(true);
    expect(can(editBanned, 'comment.create', {}, NOW).allow).toBe(true);

    const suggestBanned = makeActor({
      trustLevel: 3,
      sanctions: [{ kind: 'no_suggest', sectionId: null, endsAt: null }],
    });
    expect(can(suggestBanned, 'suggestion.create', {}, NOW).allow).toBe(false);
    expect(can(suggestBanned, 'comment.create', {}, NOW).allow).toBe(true);
  });

  it('停用账号一切被拒，拒因 suspended', () => {
    const suspended = makeActor({ status: 'suspended', trustLevel: 4 });
    expect(can(suspended, 'content.read', {}, NOW)).toEqual({
      allow: false,
      reason: { kind: 'suspended' },
    });
  });
});

describe('can() —— 所有权特例', () => {
  it('TL0 作者可直编自己的 open 文档（via owner）', () => {
    const doc = makeDoc({ ownerId: 'u1' });
    const d = can(makeActor(), 'doc.edit_direct', { doc }, NOW);
    expect(d).toEqual({ allow: true, via: 'owner', obligations: [] });
  });

  it('作者从 TL0 起即可审核/合并自己文章的建议（owner 无信任门槛，ADR-0008）', () => {
    const doc = makeDoc({ ownerId: 'u1' });
    const review = can(makeActor(), 'suggestion.review', { doc }, NOW);
    expect(review).toEqual({ allow: true, via: 'owner', obligations: [] });
    const merge = can(makeActor(), 'suggestion.merge', { doc }, NOW);
    expect(merge).toEqual({ allow: true, via: 'owner', obligations: [] });
  });

  it('locked 文档作者也不能直编——管理员强制保护压过作者自主权', () => {
    const doc = makeDoc({ ownerId: 'u1', editPolicy: 'locked' });
    const d = can(makeActor({ trustLevel: 4 }), 'doc.edit_direct', { doc }, NOW);
    expect(d).toEqual({ allow: false, reason: { kind: 'policy_locked' } });
  });
});

describe('can() —— 页面模式（私有/公共）× 信任楼层（ADR-0007）', () => {
  it('私有页：非作者 TL4 直编被拒（policy_locked，引导改提建议）', () => {
    const doc = makeDoc({ visibility: 'private' });
    const d = can(makeActor({ trustLevel: 4 }), 'doc.edit_direct', { doc }, NOW);
    expect(d).toEqual({ allow: false, reason: { kind: 'policy_locked' } });
  });

  it('缺 visibility（旧数据）按最严私有处理：非作者直编被拒', () => {
    const d = can(makeActor({ trustLevel: 4 }), 'doc.edit_direct', { doc: makeDoc() }, NOW);
    expect(d).toEqual({ allow: false, reason: { kind: 'policy_locked' } });
  });

  it('公共页：TL3 直编（申请）允许 + enqueue_patrol；TL2 被拒 required=3', () => {
    const doc = makeDoc({ visibility: 'public' });
    expect(can(makeActor({ trustLevel: 3 }), 'doc.edit_direct', { doc }, NOW)).toEqual({
      allow: true,
      via: 'trust',
      obligations: [{ type: 'enqueue_patrol' }],
    });
    expect(can(makeActor({ trustLevel: 2 }), 'doc.edit_direct', { doc }, NOW)).toEqual({
      allow: false,
      reason: { kind: 'insufficient_trust', required: 3, capability: 'doc.edit_direct' },
    });
  });

  it('管理员冻结（editPolicy=locked）压过页面模式：公共页 TL4 也被拒', () => {
    const doc = makeDoc({ visibility: 'public', editPolicy: 'locked' });
    expect(can(makeActor({ trustLevel: 4 }), 'doc.edit_direct', { doc }, NOW)).toEqual({
      allow: false,
      reason: { kind: 'policy_locked' },
    });
  });

  it('私有页：板块编辑可直编（申请，via role）', () => {
    const editor = makeActor({ trustLevel: 1, roles: [{ role: 'editor', sectionId: 's1' }] });
    const doc = makeDoc({ visibility: 'private' });
    expect(can(editor, 'doc.edit_direct', { sectionId: 's1', doc }, NOW)).toEqual({
      allow: true,
      via: 'role',
      obligations: [],
    });
  });
});

describe('can() —— 页面模式：审核/合并的管理权归属（ADR-0007）', () => {
  const editor = makeActor({ trustLevel: 1, roles: [{ role: 'editor', sectionId: 's1' }] });
  const sectionMod = makeActor({
    trustLevel: 1,
    roles: [{ role: 'section_mod', sectionId: 's1' }],
  });

  it('私有页：责任编辑无审核/合并权（管理权归所有者），落入信任线拒因', () => {
    const doc = makeDoc({ visibility: 'private' });
    const review = can(editor, 'suggestion.review', { sectionId: 's1', doc }, NOW);
    expect(review).toEqual({
      allow: false,
      reason: { kind: 'insufficient_trust', required: 4, capability: 'suggestion.review' },
    });
  });

  it('公共页：责任编辑获审核/合并权（via role）', () => {
    const doc = makeDoc({ visibility: 'public' });
    expect(can(editor, 'suggestion.review', { sectionId: 's1', doc }, NOW)).toEqual({
      allow: true,
      via: 'role',
      obligations: [],
    });
    expect(can(editor, 'suggestion.merge', { sectionId: 's1', doc }, NOW)).toEqual({
      allow: true,
      via: 'role',
      obligations: [],
    });
  });

  it('私有页：板块版主保留审核权（治理监督不受页面模式限制）', () => {
    const doc = makeDoc({ visibility: 'private' });
    expect(can(sectionMod, 'suggestion.review', { sectionId: 's1', doc }, NOW)).toEqual({
      allow: true,
      via: 'role',
      obligations: [],
    });
  });

  it('私有页：所有者从 TL0 起保留审核/合并权', () => {
    const doc = makeDoc({ ownerId: 'u1', visibility: 'private' });
    expect(can(makeActor(), 'suggestion.review', { doc }, NOW)).toEqual({
      allow: true,
      via: 'owner',
      obligations: [],
    });
    expect(can(makeActor(), 'suggestion.merge', { doc }, NOW)).toEqual({
      allow: true,
      via: 'owner',
      obligations: [],
    });
  });
});

describe('can() —— 信任线义务梯度与通用楼层', () => {
  it('评论自 TL0 起即允许、无义务（AI 审核取代预审/限速，ADR-0009）', () => {
    for (const tl of [0, 1, 2] as const) {
      expect(can(makeActor({ trustLevel: tl }), 'comment.create', {}, NOW)).toEqual({
        allow: true,
        via: 'trust',
        obligations: [],
      });
    }
  });

  it('TL0 行内评论被拒 required=1；TL1 行内评论允许且无义务（限速已取消）', () => {
    expect(can(makeActor(), 'comment.inline.create', {}, NOW)).toEqual({
      allow: false,
      reason: { kind: 'insufficient_trust', required: 1, capability: 'comment.inline.create' },
    });
    expect(can(makeActor({ trustLevel: 1 }), 'comment.inline.create', {}, NOW)).toEqual({
      allow: true,
      via: 'trust',
      obligations: [],
    });
  });

  it('修订申请 suggestion.create：缺上下文/公共页 T2，私有页 T3（ADR-0010）', () => {
    // 无 doc 上下文按公共页（T2）
    expect(can(makeActor({ trustLevel: 1 }), 'suggestion.create', {}, NOW)).toEqual({
      allow: false,
      reason: { kind: 'insufficient_trust', required: 2, capability: 'suggestion.create' },
    });
    expect(can(makeActor({ trustLevel: 2 }), 'suggestion.create', {}, NOW)).toEqual({
      allow: true,
      via: 'trust',
      obligations: [],
    });
    // 私有页：T2 被拒 required=3，T3 允许
    const priv = makeDoc({ visibility: 'private' });
    expect(can(makeActor({ trustLevel: 2 }), 'suggestion.create', { doc: priv }, NOW)).toEqual({
      allow: false,
      reason: { kind: 'insufficient_trust', required: 3, capability: 'suggestion.create' },
    });
    expect(can(makeActor({ trustLevel: 3 }), 'suggestion.create', { doc: priv }, NOW).allow).toBe(
      true,
    );
    // 公共页：T2 允许
    const pub = makeDoc({ visibility: 'public' });
    expect(can(makeActor({ trustLevel: 2 }), 'suggestion.create', { doc: pub }, NOW).allow).toBe(
      true,
    );
  });

  it('suggestion.review：非作者 TL4 经信任线允许', () => {
    expect(can(makeActor({ trustLevel: 4 }), 'suggestion.review', {}, NOW)).toEqual({
      allow: true,
      via: 'trust',
      obligations: [],
    });
  });

  it('信任线表外能力（doc.rollback）落入 role_required 拒因', () => {
    const d = can(makeActor({ trustLevel: 4 }), 'doc.rollback', {}, NOW);
    expect(d).toEqual({
      allow: false,
      reason: { kind: 'role_required', roles: ['editor', 'section_mod', 'admin', 'superadmin'] },
    });
  });

  it('TL0 基础能力：content.read / doc.create / doc.submit 均允许', () => {
    for (const cap of ['content.read', 'doc.create', 'doc.submit'] as const) {
      expect(can(makeActor(), cap, {}, NOW)).toEqual({
        allow: true,
        via: 'trust',
        obligations: [],
      });
    }
  });
});
