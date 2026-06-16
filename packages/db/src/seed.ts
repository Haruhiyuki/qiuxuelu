// 种子数据：四个顶级板块 + 信任阈值冷启动档。幂等，可重复执行。
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

// 冷启动档（架构 §4）：早期社区数据稀疏，阈值大幅调低；规模化后上调并切换 profile。
// thresholds 的形状必须与 @harublog/domain 的 TrustThresholds（trust/levels.ts 的
// COLD_START_THRESHOLDS）逐字段一致——依赖方向禁止 db import domain，故此处手抄并双向互注；
// M2 信任结算会从本 key 读出 thresholds 直接喂 computeLevel，漂移即晋升全线失效。
const TRUST_THRESHOLDS_COLD_START = {
  profile: 'cold_start',
  note: '冷启动档：社区早期数据稀疏，阈值大幅调低，随规模上调',
  thresholds: {
    windowDays: 100,
    tl1: { accountAgeDays: 1, activeDays: 1 },
    tl2: { activeDays: 5, commentsPosted: 3 },
    tl3: {
      suggestionsMerged: 3,
      maxMergeRejectRatio: 0.4,
      minFlagsAccuracy: 0.5,
      activeDays: 10,
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
        value: TRUST_THRESHOLDS_COLD_START,
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
