// 设置页通用版式：分组（带锚点标题）+ 卡片（标题/说明/内容）。纯展示组件，服务端/客户端通用。
import type { ReactNode } from 'react';

/** 一个设置分组：锚点 id + 组标题，下挂若干卡片。 */
export function SettingsGroup({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="font-semibold font-serif text-ink-900 text-lg">{title}</h2>
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** 单个设置卡片：纸底圆角描边 + 可选「标题 + 说明」头部。 */
export function SettingsCard({
  title,
  description,
  children,
  tone = 'default',
}: {
  title?: string;
  description?: ReactNode;
  children: ReactNode;
  /** danger：危险操作区，描边偏朱砂以示警 */
  tone?: 'default' | 'danger';
}) {
  return (
    <section
      className={`rounded-lg border bg-paper-50 p-5 shadow-paper sm:p-6 ${
        tone === 'danger' ? 'border-accent-200' : 'border-ink-200'
      }`}
    >
      {title !== undefined || description !== undefined ? (
        <header className="mb-4">
          {title !== undefined ? (
            <h3 className="font-medium font-serif text-base text-ink-900">{title}</h3>
          ) : null}
          {description !== undefined ? (
            <p className="mt-1 text-ink-400 text-sm leading-relaxed">{description}</p>
          ) : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}
