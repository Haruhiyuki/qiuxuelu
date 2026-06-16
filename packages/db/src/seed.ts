// 种子数据：顶级板块 + 信任积分阈值（ADR-0016）+ 私有→公共阈值。幂等，可重复执行。
import { closeDb, getDb } from './client';
import { siteSettings } from './schema/infra';
import { sections } from './schema/sections';

// 板块分类（可经超管「板块管理」后台增删改排序；stage 已退化为内部字段）
const SECTION_ROWS = [
  {
    slug: 'secondary',
    name: '中学',
    description: '初高中阶段的学习方法、学科经验与升学备考。',
    stage: 'junior',
    position: 0,
  },
  {
    slug: 'college',
    name: '大学',
    description: '大学阶段的专业学习、科研入门与生涯规划。',
    stage: 'college',
    position: 1,
  },
  {
    slug: 'mindset',
    name: '心路',
    description: '求学路上的心态、选择与成长感悟。',
    stage: 'general',
    position: 2,
  },
  {
    slug: 'observations',
    name: '见闻',
    description: '亲历的见闻、观察与经验分享。',
    stage: 'general',
    position: 3,
  },
  {
    slug: 'methodology',
    name: '通用方法',
    description: '跨阶段通用的学习方法、效率工具与心态建设。',
    stage: 'general',
    position: 4,
  },
];

// 贡献积分制阈值（ADR-0016）：TL1 发首文、TL2 累计 50 分、TL3 近一年窗口 150 分、TL4 人工认证。
// thresholds 的形状必须与 @harublog/domain 的 TrustThresholds（trust/levels.ts 的
// DEFAULT_THRESHOLDS）逐字段一致——依赖方向禁止 db import domain，故此处手抄并双向互注；
// 信任结算从本 key 读出 thresholds 直接喂 computeLevel，漂移即晋升全线失效。
const TRUST_THRESHOLDS = {
  profile: 'launch',
  note: '积分制（ADR-0016）：发文+12 / 行内批注+1 / 编辑建议+2 / 修订通过+3；TL2=50 累计、TL3=150 近一年',
  thresholds: {
    windowDays: 365,
    tl2Points: 50,
    tl3WindowPoints: 150,
    points: {
      publishDoc: 12,
      inlineComment: 1,
      feedback: 2,
      suggestionMerged: 3,
    },
  },
};

async function main(): Promise<void> {
  const db = getDb();

  await db.insert(sections).values(SECTION_ROWS).onConflictDoNothing({ target: sections.slug });

  await db
    .insert(siteSettings)
    .values([
      {
        key: 'trust.thresholds',
        value: TRUST_THRESHOLDS,
      },
      {
        // 私有→公共自动升级阈值（实质协作累计数，ADR-0007 + ADR-0013）；治理阈值入配置不硬编码
        key: 'doc.publicize',
        value: {
          threshold: 50,
          note: '私有页累计实质协作（非作者：被采纳的修订申请 + 他人直编修订）超此数自动转公共',
        },
      },
    ])
    .onConflictDoNothing({ target: siteSettings.key });

  console.log('种子数据写入完成（幂等）：4 个板块 + trust.thresholds + doc.publicize 阈值');
}

main()
  .catch((err) => {
    console.error('种子执行失败：', err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
