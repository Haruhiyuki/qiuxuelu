'use client';

// 代码块复制按钮（阅读端增强，非编辑器）：挂载后给每个 Shiki 代码块包一层相对容器并加复制按钮。
// 正文由 RSC 渲染、客户端不重渲染，故 effect 内安全地做 DOM 注入；卸载时还原。
import { useEffect } from 'react';

export function CodeCopy() {
  useEffect(() => {
    const wraps: HTMLElement[] = [];
    const pres = document.querySelectorAll<HTMLElement>('.prose-zh pre.shiki');
    for (const pre of pres) {
      if (pre.parentElement?.classList.contains('code-block-wrap')) {
        continue;
      }
      const wrap = document.createElement('div');
      wrap.className = 'code-block-wrap';
      pre.parentNode?.insertBefore(wrap, pre);
      wrap.appendChild(pre);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'code-copy';
      btn.textContent = '复制';
      btn.addEventListener('click', () => {
        const code = pre.querySelector('code')?.innerText ?? '';
        navigator.clipboard?.writeText(code).then(
          () => {
            btn.textContent = '已复制';
            window.setTimeout(() => {
              btn.textContent = '复制';
            }, 1500);
          },
          () => {
            btn.textContent = '复制失败';
          },
        );
      });
      wrap.appendChild(btn);
      wraps.push(wrap);
    }
    return () => {
      // 还原：把 pre 移回原位、移除容器与按钮
      for (const wrap of wraps) {
        const pre = wrap.querySelector('pre');
        if (pre !== null) {
          wrap.parentNode?.insertBefore(pre, wrap);
        }
        wrap.remove();
      }
    };
  }, []);
  return null;
}
