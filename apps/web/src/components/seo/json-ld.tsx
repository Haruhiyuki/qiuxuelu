// JSON-LD 结构化数据注入（受信任的服务端数据，非 UGC——渲染器的「禁 dangerouslySetInnerHTML」红线
// 针对的是用户内容；此处对 < 转义防 </script> 逃逸即安全，是 Next 官方推荐的 JSON-LD 写法）。
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify(data).replaceAll('<', '\\u003c');
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
