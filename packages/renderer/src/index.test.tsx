// 锁死 UGC XSS 红线（架构红线：渲染器禁止 dangerouslySetInnerHTML，URL 属性统一守门）。
// 通过渲染真实输出 HTML 断言：危险 scheme 不出 <a>、文本被转义、外链强制 rel 硬化。
import type { DocJson } from '@harublog/kernel';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ArticleRenderer } from './index';

function para(blockId: string, content: unknown[]): unknown {
  return { type: 'paragraph', attrs: { blockId }, content };
}
function render(doc: DocJson, siteOrigin?: string): string {
  return renderToStaticMarkup(<ArticleRenderer doc={doc} siteOrigin={siteOrigin} />);
}

describe('ArticleRenderer XSS 红线', () => {
  it('javascript: 链接降级为纯文本，不渲染 <a>', () => {
    const doc = {
      type: 'doc',
      content: [
        para('b1', [
          {
            type: 'text',
            text: '点我',
            marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
          },
        ]),
      ],
    } as DocJson;
    const html = render(doc);
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<a');
    expect(html).toContain('点我');
  });

  it('data: 链接同样被拒绝', () => {
    const doc = {
      type: 'doc',
      content: [
        para('b1', [
          {
            type: 'text',
            text: 'x',
            marks: [{ type: 'link', attrs: { href: 'data:text/html,<script>1</script>' } }],
          },
        ]),
      ],
    } as DocJson;
    const html = render(doc);
    expect(html).not.toContain('<a');
    expect(html).not.toContain('<script');
  });

  it('文本中的 HTML 被转义，不产生活动元素', () => {
    const doc = {
      type: 'doc',
      content: [para('b1', [{ type: 'text', text: '<script>alert(1)</script>&<img src=x>' }])],
    } as DocJson;
    const html = render(doc);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('外链强制 nofollow noopener ugc + target=_blank', () => {
    const doc = {
      type: 'doc',
      content: [
        para('b1', [
          {
            type: 'text',
            text: '外站',
            marks: [{ type: 'link', attrs: { href: 'https://evil.example/x' } }],
          },
        ]),
      ],
    } as DocJson;
    const html = render(doc, 'https://harublog.test');
    expect(html).toContain('href="https://evil.example/x"');
    expect(html).toMatch(/rel="nofollow noopener ugc"/);
    expect(html).toContain('target="_blank"');
  });

  it('协议相对地址 //host 按外链硬化（不得逃过 rel）', () => {
    const doc = {
      type: 'doc',
      content: [
        para('b1', [
          { type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: '//evil.example' } }] },
        ]),
      ],
    } as DocJson;
    const html = render(doc, 'https://harublog.test');
    expect(html).toMatch(/rel="nofollow noopener ugc"/);
  });

  it('本站绝对链接不打外链标记', () => {
    const doc = {
      type: 'doc',
      content: [
        para('b1', [
          {
            type: 'text',
            text: '内链',
            marks: [{ type: 'link', attrs: { href: 'https://harublog.test/a/x' } }],
          },
        ]),
      ],
    } as DocJson;
    const html = render(doc, 'https://harublog.test');
    expect(html).toContain('href="https://harublog.test/a/x"');
    expect(html).not.toContain('nofollow');
  });

  it('坏文档渲染中文占位而非抛错', () => {
    const html = renderToStaticMarkup(<ArticleRenderer doc={{ not: 'a doc' }} />);
    expect(html).toContain('未通过校验');
  });

  it('每个顶层块输出稳定锚点 b-{blockId}', () => {
    const doc = {
      type: 'doc',
      content: [para('blk-1', [{ type: 'text', text: '正文' }])],
    } as DocJson;
    const html = render(doc);
    expect(html).toContain('id="b-blk-1"');
  });
});
