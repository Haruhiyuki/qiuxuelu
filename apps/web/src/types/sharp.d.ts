// sharp 0.35 的 package.exports 未声明 types 条件（类型实际在 lib/index.d.ts），
// bundler 解析下 `import 'sharp'` 找不到声明。曾用 tsconfig paths 指向该 .d.ts，但 turbopack
// 会把该映射用于运行时解析 → 'sharp' 指向声明文件、运行时无可调用导出（上传/缩放全挂）。
// 改用环境声明：仅桥接类型，从其自带 .d.ts 转出，不影响运行时模块解析（运行时仍走真实包）。
declare module 'sharp' {
  import sharp = require('../../node_modules/sharp/lib/index.js');
  export = sharp;
}
