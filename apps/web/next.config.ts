import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 自托管 Docker 部署（架构 §1）：standalone 输出，运行时不依赖完整 node_modules
  output: 'standalone',
  // sharp 是原生模块，不能被打包，作为服务端外部依赖原样加载。
  // better-auth/resend 在 standalone 生产打包后会因 Request body/crypto 处理差异抛 "TypeError: unusable"
  // （dev 正常、prod 注册 500）；外部化让其在运行时原样加载，规避打包副作用。
  serverExternalPackages: ['sharp', 'better-auth', 'resend'],
  // workspace 包直接输出 TS 源码，必须由 Next 转译，缺一个就构建失败
  transpilePackages: [
    '@harublog/config',
    '@harublog/db',
    '@harublog/domain',
    '@harublog/editor',
    '@harublog/kernel',
    '@harublog/mailer',
    '@harublog/renderer',
    '@harublog/search',
    '@harublog/ui',
  ],
};

export default nextConfig;
