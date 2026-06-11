// 编辑器扩展集与 schema 的唯一事实源（架构 §6）：web 单人/协作编辑器与 collab 网关共用同一份，
// 保证 ProseMirror schema 严格一致（否则 Y.Doc ↔ PM JSON 转换会因 schema 不符而坏）。
import { type Extensions, getSchema } from '@tiptap/core';
import Highlight from '@tiptap/extension-highlight';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';
import type { Schema } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { BlockId } from './block-id';
import { Callout } from './callout';
import { Figure } from './figure';
import { MathBlock } from './math-block';

/** y-prosemirror 共享片段名（web 协作编辑器与 collab 网关必须一致）。 */
export const COLLAB_FRAGMENT = 'default';

export interface BuildExtensionsOptions {
  /** 协作模式下关闭本地 undo/redo——撤销栈由 Yjs（CollaborationCaret）接管。 */
  collaboration?: boolean;
}

/**
 * 构建基础扩展集：StarterKit（正文层级收敛 2–4、关 underline、link 不自动打开）+ BlockId。
 * schema 与是否协作无关，仅 undoRedo 行为不同。
 */
export function buildExtensions(options: BuildExtensionsOptions = {}): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3, 4] },
      underline: false,
      link: { openOnClick: false },
      // 协作模式：交给 Yjs 处理历史，关掉本地 undoRedo 以免与 CRDT 冲突
      ...(options.collaboration ? { undoRedo: false } : {}),
    }),
    Highlight,
    Table,
    TableRow,
    TableHeader,
    TableCell,
    Figure,
    Callout,
    MathBlock,
    BlockId,
  ];
}

/** 与编辑器一致的 ProseMirror schema（collab 网关做 Y.Doc ↔ PM JSON 转换时使用）。 */
export function getEditorSchema(): Schema {
  return getSchema(buildExtensions());
}
