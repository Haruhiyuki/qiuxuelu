import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center px-6 py-24 text-center">
      <p className="font-serif text-6xl text-ink-300">404</p>
      <h1 className="mt-4 font-semibold font-serif text-2xl text-ink-900">页面走丢了</h1>
      <p className="mt-3 text-ink-500 text-sm leading-relaxed">
        这条路走到尽头了——页面可能已被移动、删除，或链接有误。
      </p>
      <div className="mt-8 flex gap-4 text-sm">
        <Link href="/" className="text-brand-700 hover:text-brand-900">
          ← 返回首页
        </Link>
        <Link href="/search" className="text-ink-500 hover:text-brand-700">
          去搜索
        </Link>
      </div>
    </div>
  );
}
