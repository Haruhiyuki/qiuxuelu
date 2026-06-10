// 修订 diff 视图（RSC 安全）：消费 kernel 的 RevisionDiff 模型，渲染块级改动。
// 与 ArticleRenderer 同样不使用 dangerouslySetInnerHTML——diff 文本全经 React 转义。
import type { RevisionDiff, RevisionDiffEntry } from '@harublog/kernel';
import type { ReactElement, ReactNode } from 'react';

const KIND_LABEL: Record<RevisionDiffEntry['kind'], string> = {
  added: '新增',
  removed: '删除',
  modified: '修改',
  moved: '移动',
  unchanged: '未变',
};

const BLOCK_TYPE_LABEL: Record<string, string> = {
  paragraph: '段落',
  heading: '标题',
  blockquote: '引用',
  code_block: '代码',
  bullet_list: '无序列表',
  ordered_list: '有序列表',
  figure: '图片',
  table: '表格',
  callout: '提示框',
  divider: '分隔线',
  math_block: '公式',
};

function typeLabel(type: string): string {
  return BLOCK_TYPE_LABEL[type] ?? type;
}

/** 修改块的字符级片段：删除红色删除线、新增绿色、相等常态。 */
function renderSegments(entry: Extract<RevisionDiffEntry, { kind: 'modified' }>): ReactNode {
  return entry.segments.map((seg, i) => {
    // diff 片段无稳定 id，按序号作 key（同一 entry 内片段顺序稳定）
    const key = `${seg.op}-${i}`;
    if (seg.op === 'equal') {
      return <span key={key}>{seg.text}</span>;
    }
    const cls = seg.op === 'insert' ? 'diff-ins' : 'diff-del';
    return (
      <span key={key} className={cls}>
        {seg.text}
      </span>
    );
  });
}

function DiffBlock({ entry }: { entry: RevisionDiffEntry }): ReactElement {
  const moveHint =
    (entry.kind === 'moved' || entry.kind === 'modified') && 'oldPos' in entry
      ? ` · 位置 ${entry.oldPos + 1}→${entry.pos + 1}`
      : '';
  return (
    <div className={`diff-block diff-block-${entry.kind}`} data-block-type={entry.type}>
      <div className="diff-gutter">
        <span className="diff-kind">{KIND_LABEL[entry.kind]}</span>
        <span className="diff-type">
          {typeLabel(entry.type)}
          {moveHint}
        </span>
      </div>
      <div className="diff-content">
        {entry.kind === 'modified' ? (
          renderSegments(entry)
        ) : entry.kind === 'removed' ? (
          <span className="diff-del">{entry.text}</span>
        ) : entry.kind === 'added' ? (
          <span className="diff-ins">{entry.text}</span>
        ) : (
          <span>{entry.text.length > 0 ? entry.text : '（空块）'}</span>
        )}
      </div>
    </div>
  );
}

export interface RevisionDiffViewProps {
  diff: RevisionDiff;
}

/** 修订 diff 主视图：新版顺序展示改动 + 末尾单列已删除块；样式见 @harublog/ui 的 diff.css。 */
export function RevisionDiffView({ diff }: RevisionDiffViewProps): ReactElement {
  const { stats } = diff;
  const noChange = stats.added + stats.removed + stats.modified + stats.moved === 0;
  return (
    <div className="revision-diff">
      <p className="diff-stats">
        <span className="diff-stat-ins">+{stats.added} 新增</span>
        <span className="diff-stat-mod">~{stats.modified} 修改</span>
        <span className="diff-stat-move">⇅{stats.moved} 移动</span>
        <span className="diff-stat-del">−{stats.removed} 删除</span>
        <span className="diff-stat-eq">{stats.unchanged} 未变</span>
      </p>
      {noChange ? <p className="diff-empty">两个修订之间没有内容差异。</p> : null}
      <div className="diff-blocks">
        {diff.blocks.map((entry) => (
          <DiffBlock key={`${entry.kind}-${entry.blockId}`} entry={entry} />
        ))}
        {diff.removed.map((entry) => (
          <DiffBlock key={`removed-${entry.blockId}`} entry={entry} />
        ))}
      </div>
    </div>
  );
}
