'use client';

// 根级错误边界（layout 自身崩溃时的最后兜底）：必须自带 html/body。
import { useEffect } from 'react';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#1f2933',
          background: '#faf9f7',
        }}
      >
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>服务暂时不可用</h1>
          <p style={{ marginTop: '0.75rem', color: '#616e7c', fontSize: '0.875rem' }}>
            站点遇到严重错误，请刷新页面或稍后再试。
          </p>
          <p style={{ marginTop: '1.5rem' }}>
            <a href="/" style={{ color: '#1f6feb' }}>
              返回首页
            </a>
          </p>
        </div>
      </body>
    </html>
  );
}
