// 编辑器扩展集与 schema 的唯一事实源（架构 §6）：web 各编辑器共用同一份，保证 ProseMirror schema 一致。
import { type Extensions, getSchema } from '@tiptap/core';
import Highlight from '@tiptap/extension-highlight';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';
import type { Schema } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { BlockFormatting } from './block-format';
import { BlockId } from './block-id';
import { Callout } from './callout';
import { Figure } from './figure';
import { MathBlock } from './math-block';

/**
 * 构建基础扩展集：StarterKit（正文层级收敛 2–4、关 underline、link 不自动打开）+ BlockId。
 */
export function buildExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3, 4] },
      underline: false,
      link: { openOnClick: false },
    }),
    Highlight,
    Table,
    TableRow,
    TableHeader,
    TableCell,
    Figure,
    Callout,
    MathBlock,
    BlockFormatting,
    BlockId,
  ];
}

/** 与编辑器一致的 ProseMirror schema（normalize 双向 / 离线校验等场景可用）。 */
export function getEditorSchema(): Schema {
  return getSchema(buildExtensions());
}
