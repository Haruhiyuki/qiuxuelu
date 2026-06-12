// 测试版演示数据：依赖 seed.ts 的板块与「测试账号已注册」（按 email 查 id），
// 走 kernel 规范链路（validateDoc → buildManifest → blobs/revisions/blocks/refs/snapshot）
// 造已发布文章 + 评论/回复/@提及 + 行内批注 + 赞踩收藏。幂等：按 slug 跳过已存在的文章。
import { randomUUID } from 'node:crypto';
import type { BlockNode, DocJson } from '@harublog/kernel';
import {
  buildManifest,
  CANON_VERSION,
  canonicalize,
  extractText,
  SCHEMA_VERSION,
  validateDoc,
} from '@harublog/kernel';
import { eq, inArray } from 'drizzle-orm';
import { hashManifest } from './block-identity';
import { closeDb, getDb } from './client';
import { user as userTable } from './schema/auth';
import { commentAnchors, comments } from './schema/collaboration';
import {
  blobs,
  blocks,
  documentRefs,
  documents,
  publishedSnapshots,
  revisionBlocks,
  revisions,
} from './schema/content';
import { docReactions } from './schema/engagement';
import { sections } from './schema/sections';

// —— 文档 JSON 构造（attrs.blockId 直接用库内 uuid，DOM 锚点与 blocks.id 同源）——
const uid = () => randomUUID();
const text = (t: string) => ({ type: 'text' as const, text: t });
const p = (t: string) => ({
  type: 'paragraph' as const,
  attrs: { blockId: uid() },
  content: [text(t)],
});
const h2 = (t: string) => ({
  type: 'heading' as const,
  attrs: { blockId: uid(), level: 2 as const },
  content: [text(t)],
});
const ul = (items: string[]) => ({
  type: 'bullet_list' as const,
  attrs: { blockId: uid() },
  content: items.map((t) => ({
    type: 'list_item' as const,
    content: [{ type: 'paragraph' as const, content: [text(t)] }],
  })),
});
const quote = (t: string) => ({
  type: 'blockquote' as const,
  attrs: { blockId: uid() },
  content: [{ type: 'paragraph' as const, content: [text(t)] }],
});
const callout = (variant: 'info' | 'tip' | 'warn' | 'danger', t: string) => ({
  type: 'callout' as const,
  attrs: { blockId: uid(), variant },
  content: [{ type: 'paragraph' as const, content: [text(t)] }],
});

interface DemoArticle {
  slug: string;
  sectionSlug: string;
  authorEmail: string;
  title: string;
  summary: string;
  featured: boolean;
  body: BlockNode[];
  /** 锚到第 anchorBlockIndex 块（须为 paragraph）的行内批注 */
  inlineNotes: { byEmail: string; quoted: string; note: string; anchorBlockIndex: number }[];
  docComments: { byEmail: string; text: string; replies?: { byEmail: string; text: string }[] }[];
  likes: string[];
  dislikes: string[];
  bookmarks: string[];
}

const A = 'admin-test@harublog.dev';
const E = 'editor-test@harublog.dev';
const S = 'senior-test@harublog.dev';
const J = 'junior-test@harublog.dev';

const ARTICLES: DemoArticle[] = [
  {
    slug: 'demo-gaokao-100days',
    sectionSlug: 'senior-high',
    authorEmail: S,
    title: '高考最后一百天：复盘比刷题更重要',
    summary: '一个过来人的百日冲刺方法论：把每天的错误变成第二天的提分点。',
    featured: true,
    body: [
      p(
        '高三最后一百天，我把每天刷题的时间砍掉了三分之一，换成复盘。模考成绩反而从年级一百名爬到了前三十。这篇文章想讲清楚：复盘到底复什么、怎么复，以及为什么它比多刷一套卷子更值。',
      ),
      h2('为什么是复盘'),
      p(
        '刷题的边际收益在高三下学期会迅速递减：会做的题反复做只是安慰剂，不会做的题没有消化就翻篇，下次换个皮还是不会。复盘做的事情是把「不会」固定下来，逼自己直面它。',
      ),
      callout('tip', '判断标准很简单：合上答案，能不能给同桌讲明白这道题？讲不明白，就是没消化。'),
      h2('每天四十分钟怎么分配'),
      ul([
        '前二十分钟：把当天所有错题按「知识性错误 / 流程性错误 / 心态性错误」分三类记录',
        '中间十分钟：知识性错误回课本定位章节，写一句话「我缺的是什么」',
        '最后十分钟：把三天前的错题拿出来重做——隔期重做才是检验',
      ]),
      p(
        '坚持两周后你会发现，错题分类的比例会变化：知识性错误减少，流程性错误浮出来。这是好事，说明短板从「不会」变成了「不熟」，后者好治得多。',
      ),
      quote('错误不会因为被忽视而消失，只会在考场上换一身衣服回来找你。'),
      h2('心态：把模考当练习'),
      p(
        '最后阶段的模考成绩波动毫无意义，它唯一的价值是暴露问题。每次模考后给自己一小时难过的额度，然后回到复盘表前——表格不会安慰你，但它会告诉你下一步做什么。',
      ),
    ],
    inlineNotes: [
      {
        byEmail: E,
        quoted: '把「不会」固定下来',
        note: '这个表述很精准，建议在正文里展开讲讲「固定」的具体载体（错题本？卡片？）',
        anchorBlockIndex: 2,
      },
      {
        byEmail: J,
        quoted: '隔期重做才是检验',
        note: '亲测有效！我从三天改成了五天间隔，遗忘得更彻底，检验更真实。',
        anchorBlockIndex: 5,
      },
    ],
    docComments: [
      {
        byEmail: J,
        text: '看完马上把晚自习的安排改了，复盘真的比无脑刷题踏实。',
        replies: [{ byEmail: S, text: '坚持两周再回来说效果，欢迎反馈～' }],
      },
      {
        byEmail: A,
        text: '已加精选。错误三分类的框架对初中板块也适用，@编辑小蓝 可以考虑出个初中版。',
      },
    ],
    likes: [A, E, J],
    dislikes: [],
    bookmarks: [J, E],
  },
  {
    slug: 'demo-wrong-answer-notebook',
    sectionSlug: 'senior-high',
    authorEmail: E,
    title: '错题本的正确打开方式：少抄题，多写「为什么」',
    summary: '抄题一小时、翻看五分钟的错题本是无效劳动。三个改造让它真正提分。',
    featured: false,
    body: [
      p(
        '十个高中生有九个有错题本，但大多数错题本的命运是：抄得很认真，再也不翻开。问题不在坚持，在方法——错题本的价值密度太低了。',
      ),
      h2('三个改造'),
      ul([
        '不抄题干：贴照片或写页码，省下的时间写「当时卡在哪一步」',
        '必写错因：一句话，主语必须是「我」——「我把增根当成了解」而不是「这题有陷阱」',
        '每周淘汰：连续两次重做全对的题划掉，错题本应该越用越薄',
      ]),
      p(
        '改造之后，一页错题本的复习价值抵得上过去十页。更重要的是写错因的过程本身就是一次深度复盘，很多时候写到一半就明白自己缺什么了。',
      ),
      callout('warn', '警惕「收藏式学习」：错题本不是藏品，划掉一页的成就感应该大于写满一页。'),
    ],
    inlineNotes: [
      {
        byEmail: S,
        quoted: '主语必须是「我」',
        note: '这一条是全文的灵魂。归因到自己身上才有改进的抓手。',
        anchorBlockIndex: 2,
      },
    ],
    docComments: [
      { byEmail: S, text: '「越用越薄」的说法太对了，错题本是消耗品不是纪念品。' },
      { byEmail: J, text: '贴照片这个真的省命，之前抄题抄到怀疑人生。' },
    ],
    likes: [S, J, A],
    dislikes: [],
    bookmarks: [J],
  },
  {
    slug: 'demo-college-course-selection',
    sectionSlug: 'college',
    authorEmail: S,
    title: '大一选课避坑指南：学分之外你该看什么',
    summary: '绩点、兴趣、作息、师资——选课是大学第一道多目标优化题。',
    featured: true,
    body: [
      p(
        '大一新生拿到选课系统的那一刻，往往用高中思维做决定：哪门课「有用」选哪门。两年之后回头看，我最后悔和最庆幸的选择，标准都不是「有用」。',
      ),
      h2('看课表结构，不只看单门课'),
      p(
        '连着四节课的「紧凑型」课表看起来高效，实际上第三节课开始就在神游。给自己留出吃饭和发呆的缝隙，比多塞一门课重要。',
      ),
      h2('用三个问题过滤'),
      ul([
        '这门课的考核方式我能接受吗？（论文型 vs 考试型，体质完全不同）',
        '教这门课的人，学生评价里反复出现的关键词是什么？',
        '如果这学期只能记住一门课的内容，我希望是它吗？',
      ]),
      quote('选课选的不是知识清单，是你接下来四个月每周的生活节奏。'),
      p(
        '最后，留一门「无用但好奇」的课。我大一下学期选了门天文通识，和绩点无关，但它是我每周最期待的两小时——这种期待感本身就值一个学分。',
      ),
    ],
    inlineNotes: [
      {
        byEmail: A,
        quoted: '留一门「无用但好奇」的课',
        note: '强烈赞同。功利性拉满的课表是大学倦怠的最大来源之一。',
        anchorBlockIndex: 6,
      },
    ],
    docComments: [
      {
        byEmail: E,
        text: '考核方式那条太真实了，论文型课程对拖延症是降维打击。',
        replies: [{ byEmail: S, text: '哈哈，所以先认清自己是什么体质再选。' }],
      },
    ],
    likes: [A, E],
    dislikes: [J],
    bookmarks: [A],
  },
  {
    slug: 'demo-how-to-read-papers',
    sectionSlug: 'college',
    authorEmail: A,
    title: '科研入门：读论文的三遍法',
    summary: '从摘要到复现，三遍读法把一篇论文吃干榨净——附新手最常见的三个误区。',
    featured: false,
    body: [
      p(
        '刚进实验室的本科生最常见的状态：导师丢来一篇论文，从第一个词逐字读到最后一个词，三小时后只记得「好像很厉害」。读论文是有方法的，三遍法是其中最经典的一种。',
      ),
      h2('三遍各做什么'),
      ul([
        '第一遍（五分钟）：只读标题、摘要、图表和结论，回答「这篇论文解决什么问题」',
        '第二遍（半小时）：读方法和实验，标出看不懂的引用，回答「它是怎么解决的」',
        '第三遍（按需）：带着复现的目的精读，「如果是我来做，每一步会怎么做」',
      ]),
      callout('info', '大部分论文止步第一遍就够了——三遍法的前提是学会筛选，不是每篇都值得三遍。'),
      h2('新手三误区'),
      ul([
        '把读不懂归咎于自己：很多论文写得就是差，换一篇讲同一问题的综述往往豁然开朗',
        '只读不记：读完立刻用三句话写下「问题—方法—结论」，否则一周后等于没读',
        '迷信顶会：领域内被反复引用的老论文，营养常常比最新的顶会灌水文丰富',
      ]),
      p(
        '最后一个建议：找一个能讨论的人。给别人讲一遍论文，比自己读三遍记得都牢——这也是组会的真正价值。',
      ),
    ],
    inlineNotes: [],
    docComments: [
      {
        byEmail: S,
        text: '「问题—方法—结论」三句话笔记法已用半年，论文管理软件里搜起来极其方便。',
      },
    ],
    likes: [S, E],
    dislikes: [],
    bookmarks: [S],
  },
  {
    slug: 'demo-zhongkao-mindset',
    sectionSlug: 'junior-high',
    authorEmail: J,
    title: '中考前一个月，我是怎么稳住心态的',
    summary: '一个普通初三学生的真实记录：焦虑不会消失，但可以和它共处。',
    featured: false,
    body: [
      p(
        '这不是一篇方法论，是一篇流水账。中考前一个月我焦虑到失眠，后来摸索出几个土办法，写下来给和我一样容易紧张的同学。',
      ),
      h2('把焦虑写下来'),
      p(
        '睡不着的晚上，我把脑子里转的念头一条条写在纸上：「数学最后一题做不完怎么办」「体育满分稳不稳」。写完发现来回就那么五六条，没有想象中的铺天盖地。第二天白天，给每一条写一句对策，晚上就好睡多了。',
      ),
      h2('小事的确定感'),
      p(
        '每天固定时间吃饭、固定路线回家、睡前固定听同一张专辑。大考前最缺的是确定感，这些小仪式就是给自己造确定感。',
      ),
      callout(
        'tip',
        '考前一晚收拾文具袋的时候，按考试用的顺序摆放——这十分钟的掌控感比多背十个单词管用。',
      ),
      p(
        '最后想说，紧张本身不是敌人。适度的紧张是身体在帮你调动资源，告诉自己「我不是害怕，是准备好了」。',
      ),
    ],
    inlineNotes: [
      {
        byEmail: S,
        quoted: '把脑子里转的念头一条条写在纸上',
        note: '心理学上这叫「认知卸载」，是有实证支持的方法。写下来的过程本身就在降低焦虑。',
        anchorBlockIndex: 2,
      },
    ],
    docComments: [
      {
        byEmail: A,
        text: '真实的记录比方法论更打动人，这就是这个站存在的意义。',
        replies: [{ byEmail: J, text: '谢谢！希望能帮到学弟学妹。' }],
      },
      { byEmail: E, text: '「我不是害怕，是准备好了」——这句可以贴在考场门口。' },
    ],
    likes: [A, E, S],
    dislikes: [],
    bookmarks: [E],
  },
  {
    slug: 'demo-pomodoro-two-years',
    sectionSlug: 'methodology',
    authorEmail: E,
    title: '番茄工作法两年实践：它治不了拖延，但治得了失控',
    summary: '两年三千多个番茄钟之后，聊聊这个方法真正的适用边界。',
    featured: false,
    body: [
      p(
        '网上对番茄工作法的评价两极：奉为神器的和嗤之以鼻的都不少。我用了两年，结论是：它的卖点（专注）其实是副产品，真正的价值是让时间变得可观测。',
      ),
      h2('它解决什么'),
      p(
        '拖延的本质往往不是懒，是任务在脑子里是一团没有边界的雾。番茄钟把雾切成 25 分钟的砖块——「写完这章」很吓人，「先做一个番茄钟的文献摘录」不吓人。',
      ),
      h2('两年踩过的坑'),
      ul([
        '机械执行 25/5：写代码进入心流时被闹钟打断是灾难，后来改成 50/10',
        '用番茄数量考核自己：数量会催生「假装工作」，有效的是记录每个番茄做了什么',
        '所有事都套番茄：开会、回消息这类被动任务根本不适用',
      ]),
      quote('工具的边界感比工具本身重要：知道它什么时候没用，才算真正会用。'),
      p(
        '如果你只带走一句话：别问「今天学了几小时」，问「今天的时间花在哪了」。番茄钟的记录功能比计时功能值钱。',
      ),
    ],
    inlineNotes: [
      {
        byEmail: A,
        quoted: '让时间变得可观测',
        note: '一针见血。同类工具（时间块、时间日志）的共同内核都是可观测性。',
        anchorBlockIndex: 0,
      },
    ],
    docComments: [
      { byEmail: J, text: '50/10 的改法收下了，25 分钟对理科大题确实太短。' },
      { byEmail: S, text: '「假装工作」太扎心，曾经为了凑番茄数把摸鱼都计时了……' },
    ],
    likes: [A, S, J],
    dislikes: [],
    bookmarks: [A, J],
  },
];

async function main(): Promise<void> {
  const db = getDb();

  // 板块与测试账号就位检查
  const sectionRows = await db.select({ id: sections.id, slug: sections.slug }).from(sections);
  const sectionBySlug = new Map(sectionRows.map((s) => [s.slug, s.id]));
  const userRows = await db
    .select({ id: userTable.id, email: userTable.email, name: userTable.name })
    .from(userTable)
    .where(inArray(userTable.email, [A, E, S, J]));
  const userByEmail = new Map(userRows.map((u) => [u.email, u.id]));
  for (const email of [A, E, S, J]) {
    if (!userByEmail.has(email)) {
      throw new Error(`测试账号未注册：${email}（先跑账号创建步骤）`);
    }
  }

  for (const art of ARTICLES) {
    const exists = await db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.slug, art.slug))
      .limit(1);
    if (exists.length > 0) {
      console.log(`[skip] ${art.slug} 已存在`);
      continue;
    }
    const sectionId = sectionBySlug.get(art.sectionSlug);
    const authorId = userByEmail.get(art.authorEmail);
    if (sectionId === undefined || authorId === undefined) {
      throw new Error(`板块或作者缺失：${art.slug}`);
    }

    const doc: DocJson = validateDoc({ type: 'doc', content: art.body });
    const manifest = buildManifest(doc);
    const entries = manifest.entries;
    const now = new Date();

    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(documents)
        .values({
          sectionId,
          slug: art.slug,
          title: art.title,
          summary: art.summary,
          ownerId: authorId,
          status: 'published',
          editPolicy: 'suggest_only',
          featured: art.featured,
          schemaVersion: SCHEMA_VERSION,
        })
        .returning({ id: documents.id });
      const docId = inserted[0]?.id;
      if (docId === undefined) {
        throw new Error('文档插入失败');
      }

      // blobs：内容寻址去重
      const blobRows = [...manifest.blobs].map(([hash, node]) => ({
        hash,
        canonVersion: CANON_VERSION,
        schemaVersion: SCHEMA_VERSION,
        content: node,
        textPlain: extractText(node),
        sizeBytes: Buffer.byteLength(canonicalize(node), 'utf8'),
      }));
      await tx.insert(blobs).values(blobRows).onConflictDoNothing({ target: blobs.hash });

      const revInserted = await tx
        .insert(revisions)
        .values({
          documentId: docId,
          seq: 1,
          authorId,
          committerId: authorId,
          kind: 'import',
          message: '演示数据初始导入',
          manifestHash: hashManifest(entries),
          schemaVersion: SCHEMA_VERSION,
          charsDelta: [...extractText(doc)].length,
          blocksChanged: entries.length,
        })
        .returning({ id: revisions.id });
      const revId = revInserted[0]?.id;
      if (revId === undefined) {
        throw new Error('修订插入失败');
      }

      // blocks（attrs.blockId 即库内 id）+ 树表
      await tx.insert(blocks).values(
        entries.map((e, i) => ({
          id: e.blockId,
          documentId: docId,
          type: doc.content[i]?.type ?? 'paragraph',
          bornRevisionId: revId,
        })),
      );
      await tx.insert(revisionBlocks).values(
        entries.map((e, i) => ({
          revisionId: revId,
          position: i,
          blockId: e.blockId,
          blobHash: e.hash,
        })),
      );

      await tx.insert(documentRefs).values([
        { documentId: docId, name: 'draft', revisionId: revId },
        { documentId: docId, name: 'published', revisionId: revId },
      ]);
      await tx.insert(publishedSnapshots).values({
        documentId: docId,
        revisionId: revId,
        content: doc,
        approvedBy: userByEmail.get(A),
        publishedAt: now,
      });

      // 互动：赞/踩/收藏
      const reactionRows = [
        ...art.likes.map((e) => ({ kind: 'like' as const, email: e })),
        ...art.dislikes.map((e) => ({ kind: 'dislike' as const, email: e })),
        ...art.bookmarks.map((e) => ({ kind: 'bookmark' as const, email: e })),
      ];
      if (reactionRows.length > 0) {
        await tx.insert(docReactions).values(
          reactionRows.map((r) => ({
            userId: userByEmail.get(r.email) as string,
            documentId: docId,
            kind: r.kind,
          })),
        );
      }

      // 文末讨论 + 回复
      for (const c of art.docComments) {
        const top = await tx
          .insert(comments)
          .values({
            documentId: docId,
            authorId: userByEmail.get(c.byEmail),
            kind: 'doc',
            body: { text: c.text },
          })
          .returning({ id: comments.id });
        const topId = top[0]?.id;
        for (const r of c.replies ?? []) {
          await tx.insert(comments).values({
            documentId: docId,
            authorId: userByEmail.get(r.byEmail),
            parentId: topId,
            kind: 'doc',
            body: { text: r.text },
          });
        }
      }

      // 行内批注：quoted 必须真实出现在锚定块文本中，偏移按字符精确计算
      for (const note of art.inlineNotes) {
        const blockNode = doc.content[note.anchorBlockIndex];
        const entry = entries[note.anchorBlockIndex];
        if (blockNode === undefined || entry === undefined) {
          throw new Error(`${art.slug} 批注锚块越界`);
        }
        const blockText = extractText(blockNode);
        const start = blockText.indexOf(note.quoted);
        if (start === -1) {
          throw new Error(`${art.slug} 批注引文不在锚块中：${note.quoted}`);
        }
        const cm = await tx
          .insert(comments)
          .values({
            documentId: docId,
            authorId: userByEmail.get(note.byEmail),
            kind: 'inline',
            body: { text: note.note },
          })
          .returning({ id: comments.id });
        const cmId = cm[0]?.id;
        if (cmId === undefined) {
          throw new Error('批注插入失败');
        }
        await tx.insert(commentAnchors).values({
          commentId: cmId,
          blockId: entry.blockId,
          revisionId: revId,
          startOffset: start,
          endOffset: start + note.quoted.length,
          quotedText: note.quoted,
          prefix: blockText.slice(Math.max(0, start - 16), start),
          suffix: blockText.slice(start + note.quoted.length, start + note.quoted.length + 16),
          state: 'live',
        });
      }
    });
    console.log(`[ok] ${art.slug}`);
  }
  console.log('演示数据完成');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
