// 每篇文章的动态分享卡（og:image）：Next 自动据此文件注入 og/twitter image 元信息。
// CJK 字体在「生成时」于服务端取用并光栅化为 PNG——读者只下载图片、不下载字体，不违阅读端零字体红线。
import { SITE_NAME } from '@harublog/config';
import { documents, getDb, publishedSnapshots, sections } from '@harublog/db';
import { and, eq } from 'drizzle-orm';
import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = '文章分享卡';

// 取 Noto Sans SC 的按文字子集（仅卡片用到的字），Satori 据此渲染中文；取不到则返回 null（降级）。
async function loadCjkFont(text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await (
      await fetch(
        `https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@700&text=${encodeURIComponent(text)}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } },
      )
    ).text();
    const url = css.match(/src:\s*url\(([^)]+)\)/)?.[1];
    if (url === undefined) {
      return null;
    }
    return await (await fetch(url)).arrayBuffer();
  } catch {
    return null;
  }
}

export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const rows = await getDb()
    .select({ title: documents.title, section: sections.name })
    .from(documents)
    .innerJoin(sections, eq(sections.id, documents.sectionId))
    .innerJoin(publishedSnapshots, eq(publishedSnapshots.documentId, documents.id))
    .where(and(eq(documents.slug, slug), eq(documents.status, 'published')))
    .limit(1);
  const title = rows[0]?.title ?? '文章';
  const section = rows[0]?.section ?? '';
  const font = await loadCjkFont(`${title}${section}${SITE_NAME}文章分享`);

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '72px',
        background: 'linear-gradient(135deg, #faf8f3 0%, #f0ece2 100%)',
        fontFamily: 'Noto Sans SC',
      }}
    >
      <div style={{ display: 'flex', fontSize: 34, color: '#2b515a', fontWeight: 700 }}>
        {section}
      </div>
      <div
        style={{
          display: 'flex',
          fontSize: 68,
          lineHeight: 1.25,
          color: '#1c1c1c',
          fontWeight: 700,
        }}
      >
        {title}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 30,
          color: '#6b6b6b',
        }}
      >
        <span>{SITE_NAME}</span>
        <span>可协作的求学经验之书</span>
      </div>
    </div>,
    {
      ...size,
      fonts:
        font === null
          ? []
          : [{ name: 'Noto Sans SC', data: font, weight: 700 as const, style: 'normal' as const }],
    },
  );
}
