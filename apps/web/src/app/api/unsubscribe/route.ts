// 邮件一键退订：按订阅 token 删除该板块订阅（无需登录，token 即凭证）。
import { getDb, subscriptions } from '@harublog/db';
import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

function page(message: string): Response {
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>退订</title>
<style>body{font-family:system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 24px;color:#1f2933;text-align:center}
a{color:#2b515a}</style></head>
<body><h1 style="font-size:20px">${message}</h1><p><a href="/">← 返回求学路</a></p></body></html>`;
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  const token = req.nextUrl.searchParams.get('token') ?? '';
  if (token.length === 0) {
    return page('退订链接无效。');
  }
  const deleted = await getDb()
    .delete(subscriptions)
    .where(eq(subscriptions.token, token))
    .returning({ id: subscriptions.id });
  return page(
    deleted.length > 0 ? '已退订该板块，不会再收到其更新邮件。' : '该退订链接已失效或已退订。',
  );
}
