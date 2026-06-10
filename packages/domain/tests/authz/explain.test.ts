import { describe, expect, it } from 'vitest';
import { explainDeny } from '../../src/authz/explain';

describe('explainDeny —— 拒绝变引导', () => {
  it('insufficient_trust 给出晋升路径而非单纯拒绝', () => {
    const msg = explainDeny({
      kind: 'insufficient_trust',
      required: 2,
      capability: 'suggestion.create',
    });
    expect(msg).toContain('TL2');
    expect(msg).toContain('提交编辑建议');
    expect(msg).toContain('晋升');
  });

  it('TL3 引导提及建议合入', () => {
    const msg = explainDeny({
      kind: 'insufficient_trust',
      required: 3,
      capability: 'doc.edit_direct',
    });
    expect(msg).toContain('建议合入');
  });

  it('role_required 表明权力红线且列出职务中文名', () => {
    const msg = explainDeny({ kind: 'role_required', roles: ['editor', 'admin'] });
    expect(msg).toContain('责任编辑');
    expect(msg).toContain('管理员');
    expect(msg).toContain('任命');
  });

  it('sanction 带期限时给出 ISO 日期，永久时给出申诉指引', () => {
    expect(explainDeny({ kind: 'sanction', until: new Date('2026-07-01T08:00:00Z') })).toContain(
      '2026-07-01',
    );
    expect(explainDeny({ kind: 'sanction', until: null })).toContain('申诉');
  });

  it('policy_locked 引导转向编辑建议', () => {
    expect(explainDeny({ kind: 'policy_locked' })).toContain('编辑建议');
  });

  it('suspended 给出申诉出口', () => {
    expect(explainDeny({ kind: 'suspended' })).toContain('申诉');
  });
});
