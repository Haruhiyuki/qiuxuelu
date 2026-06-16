import { SITE_DESCRIPTION, SITE_NAME } from '@harublog/config';
import Link from 'next/link';
import { LogoMark } from './logo-mark';

export function SiteFooter() {
  return (
    <footer className="rule-double mt-16 bg-paper-50">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-12 sm:grid-cols-[2fr_1fr_1fr]">
        <div className="max-w-sm">
          <p className="flex items-center gap-2.5">
            <LogoMark className="h-6 w-6 shrink-0" />
            <span className="font-semibold font-serif text-ink-900 text-lg">{SITE_NAME}</span>
          </p>
          <p className="mt-3 text-ink-500 text-sm leading-relaxed">{SITE_DESCRIPTION}</p>
          <p className="mt-3 text-ink-400 text-xs leading-relaxed">
            非营利的公益项目，由社区志愿者共同撰写与维护。
          </p>
        </div>
        <nav aria-label="页脚导航" className="text-sm">
          <p className="font-medium text-ink-800">站内</p>
          <ul className="mt-3 flex flex-col gap-2 text-ink-500">
            <li>
              <Link href="/news" className="transition-colors hover:text-brand-700">
                近闻
              </Link>
            </li>
            <li>
              <Link href="/search" className="transition-colors hover:text-brand-700">
                全站搜索
              </Link>
            </li>
            <li>
              <Link href="/feed.xml" className="transition-colors hover:text-brand-700">
                RSS 订阅
              </Link>
            </li>
            <li>
              <Link href="/transparency" className="transition-colors hover:text-brand-700">
                透明度报告
              </Link>
            </li>
            <li>
              <Link href="/governance" className="transition-colors hover:text-brand-700">
                社区治理公示
              </Link>
            </li>
          </ul>
        </nav>
        <div className="text-sm">
          <p className="font-medium text-ink-800">协议与源码</p>
          <ul className="mt-3 flex flex-col gap-2 text-ink-500">
            <li>
              <a
                href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans"
                rel="license noopener"
                target="_blank"
                className="transition-colors hover:text-brand-700"
              >
                CC BY-NC-SA 4.0
              </a>
            </li>
            <li>
              <a
                href="https://github.com/Haruhiyuki/qiuxuelu"
                rel="noopener"
                target="_blank"
                className="transition-colors hover:text-brand-700"
              >
                GitHub
              </a>
            </li>
            <li>
              <Link href="/covenant" className="transition-colors hover:text-brand-700">
                社区公约
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-ink-200/70 border-t">
        <p className="mx-auto w-full max-w-6xl px-6 py-4 text-ink-400 text-xs leading-relaxed">
          除特别声明外，本站内容默认以 CC BY-NC-SA 4.0
          协议共享：转载请署名、注明出处，限非商业使用。
        </p>
      </div>
    </footer>
  );
}
