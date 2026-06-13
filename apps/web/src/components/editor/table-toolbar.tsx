'use client';

// 表格行列控制气泡：光标落入表格时浮出，做增删行列与删表。现代编辑器的表格操作标配。
// 与文本气泡（BubbleToolbar）用不同 pluginKey 且互斥显示（见 bubble-toolbar 的 shouldShow），避免叠放。
//
// 红线说明：kernel 表格模型是纯矩形网格——table_cell 无 colspan/rowspan/colwidth、无表头概念，
// normalize 落库会丢弃合并/表头（详见 packages/editor/normalize.ts）。故此处只暴露「行/列增删 + 删表」
// 这类保持矩形的操作；合并单元格 / 表头行 / 列宽拖拽需先改 kernel 块型 + 升 SCHEMA_VERSION + 写 ADR，
// 不在本组件范围内（否则编辑器能合并、存库即损坏成锯齿网格）。
import { cn } from '@harublog/ui';
import type { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import {
  BetweenHorizontalEnd,
  BetweenHorizontalStart,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Columns3,
  Rows3,
  Trash2,
} from 'lucide-react';

const ICON = 'h-4 w-4';

function Btn({
  onClick,
  title,
  danger,
  children,
}: {
  onClick: () => void;
  title: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      // onMouseDown + preventDefault：保住编辑器选区不被按钮抢焦点，命令才作用在当前单元格
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-md transition-colors',
        danger
          ? 'text-on-overlay hover:bg-accent-600 hover:text-on-fill'
          : 'text-on-overlay hover:bg-overlay-hover',
      )}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="mx-0.5 h-5 w-px bg-current opacity-20" aria-hidden />;
}

export function TableToolbar({ editor }: { editor: Editor }) {
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableMenu"
      // 光标在表格内即浮出（含折叠光标）；只读编辑器不出现
      shouldShow={({ editor: e }) => e.isEditable && e.isActive('table')}
      options={{ placement: 'top', offset: 8 }}
    >
      <div className="pop-in flex items-center gap-0.5 rounded-lg bg-overlay px-1 py-1 shadow-float">
        {/* 行 */}
        <Btn title="在上方插入行" onClick={() => editor.chain().focus().addRowBefore().run()}>
          <BetweenHorizontalStart className={ICON} />
        </Btn>
        <Btn title="在下方插入行" onClick={() => editor.chain().focus().addRowAfter().run()}>
          <BetweenHorizontalEnd className={ICON} />
        </Btn>
        <Btn title="删除本行" danger onClick={() => editor.chain().focus().deleteRow().run()}>
          <Rows3 className={ICON} />
        </Btn>
        <Sep />
        {/* 列 */}
        <Btn title="在左侧插入列" onClick={() => editor.chain().focus().addColumnBefore().run()}>
          <BetweenVerticalStart className={ICON} />
        </Btn>
        <Btn title="在右侧插入列" onClick={() => editor.chain().focus().addColumnAfter().run()}>
          <BetweenVerticalEnd className={ICON} />
        </Btn>
        <Btn title="删除本列" danger onClick={() => editor.chain().focus().deleteColumn().run()}>
          <Columns3 className={ICON} />
        </Btn>
        <Sep />
        {/* 整表 */}
        <Btn title="删除整张表格" danger onClick={() => editor.chain().focus().deleteTable().run()}>
          <Trash2 className={ICON} />
        </Btn>
      </div>
    </BubbleMenu>
  );
}
