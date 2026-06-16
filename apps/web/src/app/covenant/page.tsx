// 社区公约：注册时确认的「社区公约」的完整正文。内容据平台真实机制（CC BY-NC-SA 授权、
// 修订留痕、双线权限/信任等级、巡查举报制裁、审计与透明度）撰写，与 onboarding 同意项一致。
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Breadcrumb } from '@/components/breadcrumb';

export const metadata: Metadata = {
  title: '社区公约',
  description: '求学路的社区共同约定：内容授权、内容准则、协作礼仪与治理秩序。',
};

// 各信任等级在「个人博客（私有）/ 公共页面」上对他人文章的协作权限（与 domain can() 一致）。
// 「+」= 相对上一级新增（含下级全部）。门槛差异源于页面模式（ADR-0007/0010）。
const TIERS = [
  { tl: 'T0', name: '新成员', priv: '评论、发布新文章', pub: '评论、发布新文章' },
  { tl: 'T1', name: '成员', priv: '＋行内批注', pub: '＋行内批注、编辑建议' },
  { tl: 'T2', name: '贡献者', priv: '＋编辑建议', pub: '＋修订申请' },
  { tl: 'T3', name: '资深贡献者', priv: '＋修订申请', pub: '＋直接修订' },
  { tl: 'T4', name: '共建者', priv: '＋审核修订申请', pub: '＋审核修订申请' },
];

function Article({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-ink-200/70 border-t pt-6">
      <h2 className="flex items-baseline gap-2.5 font-semibold font-serif text-ink-900 text-xl">
        <span aria-hidden className="h-4 w-1 self-center rounded-xs bg-accent-600" />
        {title}
      </h2>
      <div className="mt-3 flex flex-col gap-2 text-ink-600 text-sm leading-relaxed">
        {children}
      </div>
    </section>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="flex gap-2">
      <span className="font-medium text-ink-800">{label}</span>
      <span className="flex-1">{children}</span>
    </p>
  );
}

export default function CovenantPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <Breadcrumb items={[{ label: '首页', href: '/' }, { label: '社区公约' }]} />

      <header className="mb-8">
        <div className="flex items-baseline gap-3">
          <span aria-hidden className="h-6 w-1.5 self-center rounded-xs bg-accent-600" />
          <h1 className="font-semibold font-serif text-3xl text-ink-900">社区公约</h1>
        </div>
        <p className="mt-4 text-ink-600 leading-relaxed">
          求学路是一个围绕各阶段求学生涯的博客平台。在这里发布的文章既是作者的个人博客，又可以由他人通过批注、编辑建议、修订申请等方式参与协作，以负责任的态度共同完成可供后来者阅读的内容。
        </p>
      </header>

      <div className="flex flex-col gap-7">
        <Article title="一、协作规则">
          <p>
            <span className="font-medium text-ink-800">共笔、真诚、开放</span>
            是求学路的精神。你在社区内参与的贡献行为越多，便拥有越高的协作权限。
          </p>
          <p>
            当一篇个人博客积累了超过{' '}
            <strong className="font-medium text-ink-800">50 条协作记录</strong>
            ，它便会升级为<span className="font-medium text-ink-800">公共页面</span>
            ，成为公共领域知识。作者依然保留对该文章的署名权与管理权，但社区内的其他贡献者也将能通过更多方式参与对该页面的贡献。
          </p>
          <p>以下是各等级贡献者在 「个人博客」与「公共页面」上所拥有的协作权限：</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] border-collapse text-sm">
              <thead>
                <tr className="border-ink-200 border-b text-ink-500 text-xs">
                  <th className="py-2 pr-3 text-left font-medium">等级</th>
                  <th className="px-3 py-2 text-left font-medium">🔒 个人博客</th>
                  <th className="px-3 py-2 text-left font-medium">🌐 公共页面</th>
                </tr>
              </thead>
              <tbody className="text-ink-600">
                {TIERS.map((t) => (
                  <tr key={t.tl} className="border-ink-100 border-b align-top last:border-0">
                    <td className="whitespace-nowrap py-2 pr-3">
                      <span className="font-medium text-ink-700">{t.tl}</span>
                      <span className="block text-ink-400 text-xs">{t.name}</span>
                    </td>
                    <td className="px-3 py-2">{t.priv}</td>
                    <td className="px-3 py-2">{t.pub}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-ink-400 text-xs leading-relaxed">
            「＋」表示该等级相对上一级新增的权限（含下级全部权限）。
          </p>
        </Article>

        <Article title="二、内容授权">
          <Item label="共享协议">
            你在此发布与贡献的内容，以{' '}
            <a
              href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans"
              target="_blank"
              rel="license noopener noreferrer"
              className="text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-900"
            >
              CC BY-NC-SA 4.0
            </a>{' '}
            协议共享：他人可在署名、非商业使用并以相同协议共享的前提下，自由使用与再创作。
          </Item>
          <Item label="署名与凭证">
            署名归原作者及全部贡献者，修订历史即贡献凭证——你的每一次贡献都会被记录与认可。
          </Item>
          <Item label="尊重版权">
            引用站外内容须注明来源、尊重他人版权；不得搬运未经授权的受版权保护材料。
          </Item>
        </Article>

        <Article title="三、内容准则">
          <Item label="真实优先">分享亲历或可查证的经验，不编造、不夸大、不带货式软广。</Item>
          <Item label="就事论事">对内容不对人，保持善意与建设性。</Item>
          <Item label="友善表达">禁止人身攻击、骚扰、仇恨与歧视言论。</Item>
          <Item label="守法合规">
            不发布违法、色情、危害未成年人、泄露他人隐私或广告营销性质的内容。
          </Item>
          <Item label="原创为本">不抄袭，转述他人观点须注明出处。</Item>
        </Article>

        <Article title="四、协作礼仪">
          <Item label="尊重他人">
            尊重他人的修订与署名；改动重要内容时，请附上一句修订说明，便于他人理解与回溯。
          </Item>
          <Item label="先沟通再动手">
            有分歧时用「修订申请」「编辑建议」与「评论」表达，而不是反复回退对方（edit war）。
          </Item>
          <Item label="不搞破坏">恶意删改、刷屏灌水、滥用回退都会被巡查发现并处置。</Item>
        </Article>

        <Article title="五、治理与秩序">
          <p>
            你能做什么，由<strong className="font-medium text-ink-800">信任等级</strong>与
            <strong className="font-medium text-ink-800">双线权限</strong>共同决定——
            <span className="text-ink-500">能力随贡献自然增长，权力经任命才被授予</span>
            ，两者不混淆。
          </p>
          <p>
            社区通过巡查队列、举报与制裁共同维护秩序。审批、回退、角色变更、内容隐去等高危操作都会记入审计，
            治理数据对外公开，可在{' '}
            <Link
              href="/transparency"
              className="text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-900"
            >
              透明度报告
            </Link>{' '}
            查看。
          </p>
          <p className="text-ink-500">
            各协作方式的具体门槛见上文「一、协作规则」；自动升级与版主任命之外的权力，一律经任命授予。
          </p>
        </Article>

        <Article title="六、举报与申诉">
          <Item label="举报">发现违规内容或行为，可就近举报，志愿者与管理员会跟进。</Item>
          <Item label="申诉">对针对你的裁决有异议，可发起申诉，我们会复核。</Item>
        </Article>
      </div>

      <p className="mt-8 border-ink-200/70 border-t pt-5 text-ink-400 text-sm leading-relaxed">
        本公约可能随社区发展而更新；重大变更会在{' '}
        <Link href="/news" className="text-brand-600 hover:text-brand-800">
          近闻
        </Link>{' '}
        中公告。感谢你与我们一起，把走过的路写成后来者的地图。
      </p>
    </div>
  );
}
