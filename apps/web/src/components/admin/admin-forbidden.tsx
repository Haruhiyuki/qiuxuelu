// 管理后台统一「无权访问」：各子页能力不足时一致呈现（取代各页手写的 403 块）。
import Link from 'next/link';

export function AdminForbidden({ reason }: { reason?: string }) {
  return (
    <div className="mx-auto w-full max-w-xl px-6 py-20 text-center">
      <h1 className="font-semibold font-serif text-2xl text-ink-900">403 · 无权访问</h1>
      <p className="mt-3 text-ink-500 text-sm">{reason ?? '你的角色没有访问该页面的权限。'}</p>
      <p className="mt-6 text-sm">
        <Link href="/admin" className="text-brand-700 transition-colors hover:text-brand-900">
          ← 返回管理后台
        </Link>
      </p>
    </div>
  );
}
