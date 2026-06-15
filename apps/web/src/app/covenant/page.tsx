// 社区公约：注册时确认的「社区公约」的完整正文。内容据平台真实机制（CC BY-SA 授权、
// 修订留痕、双线权限/信任等级、巡查举报制裁、审计与透明度）撰写，与 onboarding 同意项一致。
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Breadcrumb } from '@/components/breadcrumb';

export const metadata: Metadata = {
  title: '社区公约',
  description: '求学路的社区共同约定：内容授权、内容准则、协作礼仪与治理秩序。',
};

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
          求学路是一本由大家共同编纂的求学经验之书。你写下的内容会被他人阅读、修订与再发布——为了让协作既开放又有秩序，请与我们共同遵守以下约定。注册时你确认的「社区公约」，即指本页。
        </p>
      </header>

      <div className="flex flex-col gap-7">
        <Article title="一、关于这个平台">
          <p>
            这里的每篇文章都是一份「活文档」：在权限允许下，他人可以修订你的内容。每一次改动都会留痕、可追溯、可回退——
            修订历史本身就是大家的共同创作记录。
          </p>
          <p>我们珍视真实、可考、对后来者真正有用的求学经验，而非流量与喧哗。</p>
        </Article>

        <Article title="二、内容授权">
          <Item label="共享协议">
            你在此发布与贡献的内容，以{' '}
            <a
              href="https://creativecommons.org/licenses/by-sa/4.0/deed.zh-hans"
              target="_blank"
              rel="license noopener noreferrer"
              className="text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-900"
            >
              CC BY-SA 4.0
            </a>{' '}
            协议共享：他人可在署名并以相同协议共享的前提下，自由使用与再创作。
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

          <p className="pt-2">
            <span className="font-medium text-ink-800">协作权：公共页 / 私有页两条线。</span>对
            <span className="font-medium text-ink-700">自己的文章</span>
            ，从注册起（TL0）就拥有完整协作权；对
            <span className="font-medium text-ink-700">他人的文章</span>
            ，三种协作方式的门槛取决于页面是公共还是私有（能力阶梯：编辑建议 ＜ 修订申请 ＜ 修订）：
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] border-collapse text-sm">
              <thead>
                <tr className="border-ink-200 border-b text-ink-500 text-xs">
                  <th className="py-2 pr-3 text-left font-medium">协作方式</th>
                  <th className="px-3 py-2 text-left font-medium">🌐 公共页</th>
                  <th className="px-3 py-2 text-left font-medium">🔒 私有页</th>
                </tr>
              </thead>
              <tbody className="text-ink-600">
                {[
                  ['编辑建议', '提意见、不改内容', 'T1', 'T2'],
                  ['修订申请', '改内容，需审核才生效', 'T2', 'T3'],
                  ['修订', '改内容，立即生效（可撤回）', 'T3', '权限者'],
                ].map((row) => (
                  <tr key={row[0]} className="border-ink-100 border-b align-top last:border-0">
                    <td className="py-2 pr-3">
                      <span className="font-medium text-ink-700">{row[0]}</span>
                      <span className="block text-ink-400 text-xs">{row[1]}</span>
                    </td>
                    <td className="px-3 py-2">{row[2]}</td>
                    <td className="px-3 py-2">{row[3]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-ink-400 text-xs leading-relaxed">
            权限者 = 作者本人 + 板块版主及以上。私有页累计 50 次实质协作（他人被采纳的修订申请 +
            直编修订；评论、编辑建议等更轻的参与不计）会自动转为公共页，也可由管理员手动设置；升级后保留原作者署名。
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
