import { SITE_NAME } from '@harublog/config';
import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="border-t border-ink-200 bg-paper-50">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-6 py-8 text-sm text-ink-500">
        <p>「{SITE_NAME}」是非营利的公益项目，由社区志愿者共同撰写与维护。</p>
        <p>
          除特别声明外，本站内容默认以{' '}
          <a
            href="https://creativecommons.org/licenses/by-sa/4.0/deed.zh-hans"
            rel="license noopener"
            target="_blank"
            className="text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-900"
          >
            CC BY-SA 4.0
          </a>{' '}
          协议共享。
        </p>
        <p className="flex flex-wrap gap-4">
          <Link href="/transparency" className="text-ink-500 hover:text-brand-700">
            透明度报告
          </Link>
          {/* 仓库地址未定，先以组织名占位 */}
          <a
            href="https://github.com/harublog"
            rel="noopener"
            target="_blank"
            className="text-ink-500 underline decoration-ink-300 underline-offset-2 hover:text-ink-700"
          >
            GitHub
          </a>
        </p>
      </div>
    </footer>
  );
}
