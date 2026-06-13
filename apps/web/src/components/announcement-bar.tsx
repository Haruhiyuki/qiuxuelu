'use client';

// 首页公告栏：展示最新置顶公告，可关闭（按公告 id 记 localStorage，换新公告会重新出现）。
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

  return (
    <section
      className={`fade-in rounded-md border px-4 py-2.5 ${
        notice
          ? 'border-accent-200 bg-accent-50 text-accent-900'
          : 'border-brand-200 bg-brand-50 text-brand-900'
      }`}
      aria-label="站点公告"
    >
      <div className="flex items-center gap-3">
        <Megaphone
          className={`h-4 w-4 shrink-0 ${notice ? 'text-accent-600' : 'text-brand-600'}`}
          aria-hidden
        />
        <p className="min-w-0 flex-1 truncate text-sm">
          <span className="font-medium">{props.title}</span>
          {props.linkHref !== null ? (
            internal ? (
              <Link
                href={props.linkHref}
                className="ml-2 whitespace-nowrap underline underline-offset-2 hover:opacity-80"
              >
                {props.linkLabel ?? '查看'}
              </Link>
            ) : (
              <a
                href={props.linkHref}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 whitespace-nowrap underline underline-offset-2 hover:opacity-80"
              >
                {props.linkLabel ?? '查看'}
              </a>
            )
          ) : (
            <Link
              href="/news"
              className="ml-2 whitespace-nowrap underline underline-offset-2 hover:opacity-80"
            >
              近闻
            </Link>
          )}
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="关闭公告"
          className="shrink-0 rounded p-0.5 transition-opacity hover:opacity-70"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </section>
  );
}
