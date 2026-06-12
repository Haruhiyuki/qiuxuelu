import type { Capability, Role } from './capabilities';
import type { DenyReason } from './types';

const CAP_LABELS: Record<Capability, string> = {
  'content.read': '阅读内容',
  'comment.create': '发表评论',
  'comment.inline.create': '发表行内评论',
  'comment.moderate': '管理评论',
  'suggestion.create': '提交编辑建议',
  'suggestion.review': '审校编辑建议',
  'suggestion.merge': '合入编辑建议',
  'doc.create': '创建文章',
  'doc.submit': '提交审批',
  'doc.edit_direct': '直接编辑',
  'media.upload': '上传图片',
  'doc.publish': '发布文章',
  'doc.unpublish': '下线文章',
  'doc.protect': '设置保护级',
  'doc.feature': '精选文章',
  'doc.set_visibility': '转为公共页面',
  'doc.rollback': '回滚版本',
  'flag.create': '提交举报',
  'flag.review': '处理举报',
  'queue.claim': '认领审校任务',
  'user.suspend': '停用账号',
  'user.trust_adjust': '调整信任等级',
  'role.grant_section': '任命板块职务',
  'role.grant_global': '任命全局职务',
  'section.manage': '管理板块',
  'announcement.manage': '发布站点公告',
  'system.config': '修改系统配置',
};

const ROLE_LABELS: Record<Role, string> = {
  editor: '责任编辑',
  section_mod: '板块版主',
  admin: '管理员',
  superadmin: '超级管理员',
};

// 按目标等级给出晋升路径文案——拒绝变引导是增长机制（架构 §4），语气面向「下一步行动」而非「资格不足」。
function trustGuidance(required: number, capLabel: string): string {
  switch (required) {
    case 1:
      return `解锁「${capLabel}」需要 TL1（成员）。注册满几天、保持阅读与基础活跃即可自动晋升——很快就到。`;
    case 2:
      return `解锁「${capLabel}」需要 TL2（贡献者）。再发表几条评论、保持活跃即可晋升，届时还将解锁编辑建议。`;
    case 3:
      return `解锁「${capLabel}」需要 TL3（资深）。再获得几次建议合入并保持举报准确即可晋升——每一次被采纳的建议都在加速这一天。`;
    case 4:
      return `解锁「${capLabel}」需要 TL4（共建者）。TL4 由社区提名并人工授予，持续的高质量贡献会被看见。`;
    default:
      return `解锁「${capLabel}」需要更高的信任等级（TL${required}）。持续贡献即可晋升。`;
  }
}

// 用 ISO 日期保证文案可测且与时区无关；本地化展示交给前端。
function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 结构化拒因 → 中文晋升引导文案。前端直接渲染；按钮显隐复用同一 Decision。 */
export function explainDeny(reason: DenyReason): string {
  switch (reason.kind) {
    case 'suspended':
      return '你的账号已被停用，暂时无法执行任何操作。如有异议，请联系管理员申诉。';
    case 'sanction':
      return reason.until === null
        ? '你的账号当前处于受限状态，该操作暂不可用。如有异议，请联系板块版主申诉。'
        : `你的账号受限至 ${formatDate(reason.until)}，届时将自动恢复。如有异议，请联系板块版主申诉。`;
    case 'insufficient_trust':
      return trustGuidance(reason.required, CAP_LABELS[reason.capability]);
    case 'role_required': {
      const roles = reason.roles.map((r) => ROLE_LABELS[r]).join('、');
      return `该操作属于职务权限（${roles}），由任命产生——信任等级再高也不会自动获得。这是社区的权力红线：晋升给能力，任命给权力。`;
    }
    case 'policy_locked':
      return '这篇文章当前不开放直接编辑。你可以提交编辑建议，经作者或审校通过后将合入正文——这同样是被记录的贡献。';
  }
}
