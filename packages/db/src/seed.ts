// 种子数据：四个顶级板块 + 信任阈值冷启动档。幂等，可重复执行。
import { closeDb, getDb } from './client';
import { siteSettings } from './schema/infra';
import { sections } from './schema/sections';

const SECTION_ROWS = [
  {
    slug: 'junior-high',
    name: '初中',
    description: '初中阶段的学习方法、学科经验与升学准备。',
    stage: 'junior',
    position: 0,
  },
  {
    slug: 'senior-high',
    name: '高中',
    description: '高中阶段的学科攻略、备考心得与高考经验。',
    stage: 'senior',
    position: 1,
  },
  {
    slug: 'college',
    name: '大学',
    description: '大学阶段的专业学习、科研入门与生涯规划。',
    stage: 'college',
    position: 2,
  },
  {
    slug: 'methodology',
    name: '通用方法论',
    description: '跨阶段通用的学习方法、效率工具与心态建设。',
    stage: 'general',
    position: 3,
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
    .values({
      key: 'trust.thresholds',
      value: TRUST_THRESHOLDS_COLD_START,
    })
    .onConflictDoNothing({ target: siteSettings.key });

  console.log('种子数据写入完成（幂等）：4 个板块 + trust.thresholds 冷启动档');
}

main()
  .catch((err) => {
    console.error('种子执行失败：', err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
