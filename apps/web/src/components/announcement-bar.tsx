'use client';

// 首页公告栏：展示最新置顶公告，可关闭（按公告 id 记 localStorage，换新公告会重新出现）。
// 视觉走「纸页与批注」克制路线：纸底 + 墨字 + 左侧一道细竖标（notice=朱砂 / info=黛青），
// 不做整条色块铺底——朱砂只作印记式点缀，避免大面积红色刺眼。
import { Megaphone, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export interface BannerProps {
  id: string;
  title: string;
  level: 'info' | 'notice';
  linkHref: string | null;
  linkLabel: string | null;
}

const DISMISS_KEY = 'harublog.dismissed-announcement';

export function AnnouncementBar(props: BannerProps) {
  // 默认隐藏，挂载后再据 localStorage 决定是否显示——避免「已关闭却闪现」
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      setShow(localStorage.getItem(DISMISS_KEY) !== props.id);
    } catch {
      setShow(true);
    }
  }, [props.id]);

  if (!show) {
    return null;
  }

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, props.id);
    } catch {
      // 忽略：隐私模式等
    }
    setShow(false);
  };

  const notice = props.level === 'notice';
  const internal = props.linkHref?.startsWith('/') ?? false;
  const linkClass =
    'ml-2 whitespace-nowrap text-brand-700 underline decoration-brand-300 underline-offset-2 transition-colors hover:text-brand-900 hover:decoration-brand-500';

  return (
    <section
      className={`fade-in flex items-center gap-3 overflow-hidden rounded-md border border-ink-200 border-l-[3px] bg-paper-50 py-2.5 pr-3 pl-3.5 shadow-paper ${
        notice ? 'border-l-accent-500' : 'border-l-brand-500'
      }`}
      aria-label="站点公告"
    >
      <Megaphone
        className={`h-4 w-4 shrink-0 ${notice ? 'text-accent-600' : 'text-brand-500'}`}
        aria-hidden
      />
      <p className="min-w-0 flex-1 truncate text-ink-600 text-sm">
        <span className="font-medium text-ink-900">{props.title}</span>
        {props.linkHref !== null ? (
          internal ? (
            <Link href={props.linkHref} className={linkClass}>
              {props.linkLabel ?? '查看'}
            </Link>
          ) : (
            <a
              href={props.linkHref}
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              {props.linkLabel ?? '查看'}
            </a>
          )
        ) : (
          // 无显式链接时，「了解更多」指向这条公告自己的近闻博客页
          <Link href={`/news/${props.id}`} className={linkClass}>
            了解更多
          </Link>
        )}
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="关闭公告"
        className="-mr-0.5 shrink-0 rounded p-0.5 text-ink-400 transition-colors hover:text-ink-700"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </section>
  );
}
