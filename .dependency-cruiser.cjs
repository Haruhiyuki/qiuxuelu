/**
 * 依赖方向铁律（见 docs/02-architecture.md §2）：
 *   kernel ← db ← domain ← apps；renderer/editor 只依赖 kernel；ui 不依赖业务包。
 * CI 中违反即红灯——模块边界是未来拆分服务的切口，必须机器强制而非自觉。
 */
module.exports = {
  forbidden: [
    {
      name: 'kernel-imports-nothing-internal',
      comment: 'kernel 是纯函数内核，不得依赖任何其他工作空间包',
      severity: 'error',
      from: { path: '^packages/kernel' },
      to: { path: '^(packages/(db|domain|renderer|editor|search|ui|config)|apps/)' },
    },
    {
      name: 'db-only-kernel',
      severity: 'error',
      from: { path: '^packages/db' },
      to: { path: '^(packages/(domain|renderer|editor|search|ui)|apps/)' },
    },
    {
      name: 'domain-no-upward',
      severity: 'error',
      from: { path: '^packages/domain' },
      to: { path: '^(packages/(renderer|editor|ui)|apps/)' },
    },
    {
      name: 'renderer-only-kernel',
      severity: 'error',
      from: { path: '^packages/renderer' },
      to: { path: '^(packages/(db|domain|editor|search)|apps/)' },
    },
    {
      name: 'editor-only-kernel',
      comment: 'editor 是 Tiptap 扩展集，内部只依赖 kernel',
      severity: 'error',
      from: { path: '^packages/editor' },
      to: { path: '^(packages/(db|domain|renderer|search|ui)|apps/)' },
    },
    {
      name: 'ui-is-leaf',
      comment: 'ui 是纯设计系统，不得依赖业务包',
      severity: 'error',
      from: { path: '^packages/ui' },
      to: { path: '^(packages/(db|domain|kernel|renderer|editor|search)|apps/)' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
  },
};
