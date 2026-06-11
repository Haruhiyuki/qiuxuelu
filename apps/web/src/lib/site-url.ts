// 站点绝对地址（sitemap / robots / RSS / JSON-LD 需要绝对 URL）；缺省回落本地。
export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
);
