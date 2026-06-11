// 数学块渲染：KaTeX 仅作 LaTeX→MathML 转换器（output:'mathml'），由浏览器原生渲染 MathML。
// 这样零 KaTeX 字体下载（守「阅读端零字体」红线）、零客户端 JS。trust:false → 产出纯数学标记、无脚本注入面，
// 故此处 dangerouslySetInnerHTML 是受控转换结果（非 UGC 原样注入）；渲染器本体仍不含 innerHTML。
import katex from 'katex';
import type { ReactNode } from 'react';

export function renderMath(latex: string): ReactNode {
  let html: string;
  try {
    html = katex.renderToString(latex, {
      displayMode: true,
      output: 'mathml',
      throwOnError: false,
      strict: false,
      trust: false,
    });
  } catch {
    return <pre className="math-block">{latex}</pre>;
  }
  return <div className="math-block" dangerouslySetInnerHTML={{ __html: html }} />;
}
