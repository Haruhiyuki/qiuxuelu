// 社区公约：注册时确认的「社区公约」的完整正文。内容据平台真实机制（CC BY-NC-SA 授权、
// 修订留痕、双线权限/信任等级、巡查举报制裁、审计与透明度）撰写，与 onboarding 同意项一致。
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Breadcrumb } from '@/components/breadcrumb';
// 权限表与个人资料的「权限路线图」共用同一份等级数据，二者永不分叉
import { TRUST_TIERS } from '@/lib/trust-tiers';

export const metadata: Metadata = {
  title: '社区公约',
  description: '求学路的社区共同约定：内容授权、内容准则、协作礼仪与社区治理。',
};

// 各等级升级要求（定性描述；具体阈值由 site_settings 治理配置，不在此硬编码）。
// 维度与 TrustRoadmap 的 requirementsFor / domain TrustThresholds 对应。
const UPGRADE_REQS = [
  { tl: 'TL0', name: '新成员', req: '注册即是' },
  { tl: 'TL1', name: '成员', req: '账号达到一定注册时长与累计活跃天数' },
  { tl: 'TL2', name: '贡献者', req: '保持活跃，并积累一定的评论参与' },
  {
    tl: 'TL3',
    name: '资深贡献者',
    req: '近期窗口内：修订申请被采纳达标、被拒比例与举报命中率达标，并保持活跃（持续考核，跌破会回落）',
  },
  { tl: 'TL4', name: '共建者', req: '无自动路径，由社区提名 + 超级管理员人工授予' },
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
                {TRUST_TIERS.map((t) => (
                  <tr key={t.level} className="border-ink-100 border-b align-top last:border-0">
                    <td className="whitespace-nowrap py-2 pr-3">
                      <span className="font-medium text-ink-700">T{t.level}</span>
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
          <Item label="真诚为上">
            发表切身经验感悟，不编造夸大，不通过 AI 生成不属于自身想法的内容。
          </Item>
          <Item label="再三审慎">负责任地发布内容，尽力确保自己对内容的审视。</Item>
          <Item label="友善表达">禁止人身攻击、骚扰、仇恨与歧视言论。</Item>
          <Item label="守法合规">不发布违法、危害未成年人、泄露他人隐私或广告营销性质的内容。</Item>
        </Article>

        <Article title="四、协作礼仪">
          <Item label="尊重他人">尊重他人创作，协作时尽量附上说明，便于他人理解。</Item>
          <Item label="合理解决分歧">
            内容存在分歧时，通过非覆盖式的协作方式合理表达，理性沟通解决。
          </Item>
          <Item label="不搞破坏">恶意删改、刷屏灌水、滥用回退都会被巡查发现并处置。</Item>
        </Article>

        <Article title="五、社区治理">
          <p>
            社区通过巡查队列、举报与制裁共同维护秩序，治理操作留痕可追溯；治理数据对外公开，可在{' '}
            <Link
              href="/transparency"
              className="text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-900"
            >
              透明度报告
            </Link>{' '}
            和{' '}
            <Link
              href="/governance"
              className="text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-900"
            >
              社区治理公示
            </Link>{' '}
            查看。
          </p>
          <p>
            通过参与贡献，用户可以从 <span className="font-medium text-ink-800">TL0</span>{' '}
            逐渐升级为 <span className="font-medium text-ink-800">TL4</span>
            ，拥有越来越多的协作能力。以下是各等级的升级要求：
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] border-collapse text-sm">
              <thead>
                <tr className="border-ink-200 border-b text-ink-500 text-xs">
                  <th className="py-2 pr-3 text-left font-medium">等级</th>
                  <th className="px-3 py-2 text-left font-medium">升级要求</th>
                </tr>
              </thead>
              <tbody className="text-ink-600">
                {UPGRADE_REQS.map((u) => (
                  <tr key={u.tl} className="border-ink-100 border-b align-top last:border-0">
                    <td className="whitespace-nowrap py-2 pr-3">
                      <span className="font-medium text-ink-700">{u.tl}</span>
                      <span className="block text-ink-400 text-xs">{u.name}</span>
                    </td>
                    <td className="px-3 py-2">{u.req}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-ink-400 text-xs leading-relaxed">
            具体阈值由站点治理配置并随社区规模调整；登录后可在个人主页的「权限路线图」查看自己的实时进度。
          </p>
          <p>
            经超级管理员任命，管理员、板块版主、编辑可以不同程度地行使治理权力，接受社区的公开监督。
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
