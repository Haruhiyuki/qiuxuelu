# 测试版部署运维手册（testblog.haruyuki.cn）

> 目标：把本地构建好的 web 安全推上测试服务器，**绝不影响同机其它 ~10 个服务**。
> 本手册不含任何密钥；凭据存放见末尾「凭据与访问」。

## 协作前提（红线，先读）

- **本地优先**：所有新需求一律先在本地开发、本地测试通过，**不背部署包袱**。
- **按需部署**：只有用户明确说「上测试站 / 部署」时才部署；其余时间只提交到本地 git。
- 部署只动 `harublog-web` 一个服务，nginx 与邻居站（`haruyuki.cn`、`test.haruyuki.cn`）零改动；每次部署后都要回归确认邻居站仍可访问。

## 目标环境一览

| 项 | 值 |
|----|----|
| 域名 | `testblog.haruyuki.cn`（nginx vhost → `127.0.0.1:3100`） |
| 服务器 | `119.23.77.86`（root；走 SSH key，见末尾） |
| systemd 单元 | `harublog-web`（`Type=simple`，`MemoryMax=600M`/`MemoryHigh=480M`） |
| 工作目录 | `/opt/harublog/web/apps/web`，`ExecStart=node …/server.js` |
| 部署根（standalone 摊平） | `/opt/harublog/web/`：`apps/web/{.next,server.js,package.json,node_modules}` + 顶层 `node_modules` |
| 环境变量 | `/opt/harublog/web.env`（PORT=3100、DATABASE_URL、BETTER_AUTH_*、S3_*、MEILI*、RESEND*、DEEPSEEK_API_KEY 等） |
| 对象存储 | MinIO 单机版（**systemd 原生**，非 docker——本机无 docker）：单元 `harublog-minio`，绑 `127.0.0.1:9000`（控制台 `:9001`），数据 `/opt/harublog/minio-data`，凭证 `/opt/harublog/minio.env`（= web.env 的 `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`），桶 `harublog-media`，`MemoryMax=320M`。二进制 `/usr/local/bin/{minio,mc}` |
| 日志 | `/var/log/harublog-web.log` |
| 服务器 node | v20.19.5；PostgreSQL 本机 `127.0.0.1`（已加 2G swap + 低内存调参）；**无 docker/podman**，所有服务皆 systemd 原生 |

服务器内存紧张（~1.6G，且跑着 ~10 个别的服务）：**绝不在服务器上构建**，构建一律在本地完成、只传产物。

## 构建约束（为什么不能简单 docker build）

- 服务器是 **linux/amd64**；原生模块（`sharp`）必须是 amd64 二进制。
- 本机 Docker Desktop VM 只分到 ~0.9G，**跑不动模拟 amd64 的 Next 构建**；而重启 Docker 会杀掉用户在跑的 `napcat`/`cpolar`/`harublog-postgres`——**不要重启 Docker**。

由此分两条路：

### 路径 A —— JS-only 快速更新（默认，无依赖变更时用）

适用：本次改动是**纯 TS/JS**，没动 `package.json`/lockfile、没加原生依赖。
原理：Next `standalone` 的 `.next` 产物是**可移植 JS**，可在 Mac（arm64）原生构建，
只替换服务器的 `.next` + `server.js`，**完全不碰 `node_modules`**（保留服务器现有的
linux-x64 `sharp` 与 `@swc/helpers` 补丁）。绝大多数迭代（纯前后端 TS/JS 改动）走此路。

```bash
# 1) 本机原生构建（arm64，内存充足）
NODE_OPTIONS=--max-old-space-size=6144 NEXT_TELEMETRY_DISABLED=1 \
  pnpm --filter @harublog/web build

# 2) 把 static 并入 standalone 的 .next（standalone 默认不含 static）
cp -R apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static

# 3) 只打包 .next + server.js（COPYFILE_DISABLE 去掉 macOS xattr 噪音）
COPYFILE_DISABLE=1 tar -C apps/web/.next/standalone \
  -czf /tmp/hb-web.tgz apps/web/.next apps/web/server.js

# 4) 传到服务器
scp -i ~/.ssh/harublog_deploy /tmp/hb-web.tgz root@119.23.77.86:/tmp/hb-web.tgz
```

服务器侧换包（停→备份→换→起→探活）：

```bash
ssh -i ~/.ssh/harublog_deploy root@119.23.77.86 'bash -s' <<'REMOTE'
set -e
TS=$(date +%Y%m%d-%H%M%S); WEB=/opt/harublog/web/apps/web; STAGE=/tmp/hb-stage-$TS
mkdir -p "$STAGE"; tar -C "$STAGE" -xzf /tmp/hb-web.tgz
test -f "$STAGE/apps/web/server.js" && test -d "$STAGE/apps/web/.next/server/app"   # 校验
systemctl stop harublog-web
mv "$WEB/.next" "$WEB/.next.bak-$TS"; cp "$WEB/server.js" "$WEB/server.js.bak-$TS"   # 备份（回滚用）
mv "$STAGE/apps/web/.next" "$WEB/.next"; cp "$STAGE/apps/web/server.js" "$WEB/server.js"
systemctl start harublog-web; sleep 6
systemctl is-active harublog-web
curl -s -o /dev/null -w "GET / -> %{http_code}\n" --max-time 15 http://127.0.0.1:3100/
tail -6 /var/log/harublog-web.log; rm -rf "$STAGE"
REMOTE
```

> 一致性：服务器 `node_modules` 是用**同一份 lockfile**构建的，没动依赖时与新 `.next` 完全兼容；
> 新代码只新增了已存在包（`react-dom` 的 `createPortal`、`lucide-react` 图标）的用法，trace 集不变。

### 路径 B —— 完整重建（依赖/原生模块变更时才用）

触发：动了 `package.json`/lockfile、升级或新增原生依赖（如 `sharp`）。
此时必须产出真正的 **linux/amd64** `node_modules`：

- 需要一个有足够内存的 amd64 构建环境（临时调大 Docker 内存 = 会重启 Docker、影响他人，**先征得用户同意**；或用别的 amd64 builder）。
- 已知坑：standalone 的 `@swc/helpers` trace 会缺文件 → 需把**完整** `@swc/helpers` 包覆盖进 standalone 的所有 `@swc/helpers` 目录及两个主 `node_modules`。
- `sharp` 走 `serverExternalPackages`（不打包），需确保 amd64 安装出 `@img/sharp-linux-x64` + `@img/sharp-libvips-linux-x64`（glibc，非 musl）。
- 换包时连 `node_modules` 一起替换，但 `sharp`/`@img` 要用 amd64 版本（见「已知问题」）。

## 数据库迁移

仅当改了 `packages/db/src/schema/*` 时才需要：本地 `pnpm db:generate` 生成迁移文件入库，再在服务器 DB 上应用。迁移要在换包**之前/同步**完成，避免新代码碰旧表。

**应用方式（已验证可用）——服务器侧 `psql` + 手动记账，不要用 SSH 隧道 + `drizzle-kit migrate`**：

- `drizzle-kit migrate`（无论本地连服务器，还是 SSH 隧道）读不到 `DATABASE_URL` 时只报一句无信息的 `undefined`/`url: ''`，排查成本高——**已知坑，不走它**。
- 改走：把 `.sql` 内容用服务器本机 `psql` 在一个事务里执行（`psql -v ON_ERROR_STOP=1`），成功后**手动插入** drizzle 账本一行，drizzle 才认为该迁移已应用：
  ```sql
  -- drizzle 的迁移哈希 = 该 .sql 文件内容的 sha256（本地 `shasum -a 256 drizzle/00NN_*.sql` 取得）
  -- created_at = drizzle/meta/_journal.json 里该迁移条目的 "when"（毫秒时间戳）
  INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('<sha256>', <when>);
  ```
- **含数据回填的迁移**（如 CHECK 收紧）：drizzle 生成的 SQL 只改约束、不迁数据；若旧值会违反新约束，必须在新生成的（未合入的）迁移文件里**手加 `UPDATE` 回填**，再于同一事务内执行。例：ADR-0011 把 `edit_policy` 收为 `open/locked`，迁移 0022 内含 `UPDATE documents SET edit_policy='open' WHERE edit_policy NOT IN ('open','locked')`。

## 部署后验证清单

1. `systemctl is-active harublog-web` = active；`curl 127.0.0.1:3100/` = 200；日志无报错。
2. 域名侧 `curl` 关键页（`/`、`/a/<slug>`、`/login`、`/news`）均 200；HTML 含本次功能标记。
3. 真实浏览器（headless chrome + CDP）验证本次改动涉及的**关键交互**（服务端 action 往返、移动端抽屉、弹窗等）。见 [[local-cdp-testing]] 记忆。
4. 邻居站回归：`curl https://haruyuki.cn`、`https://test.haruyuki.cn` 仍正常响应。

## 回滚

```bash
ssh -i ~/.ssh/harublog_deploy root@119.23.77.86 'bash -s' <<'REMOTE'
set -e; WEB=/opt/harublog/web/apps/web
BK=$(ls -d $WEB/.next.bak-* | sort | tail -1)          # 最近一次备份
systemctl stop harublog-web
rm -rf $WEB/.next; mv "$BK" $WEB/.next
cp $WEB/server.js.bak-* $WEB/server.js 2>/dev/null || true
systemctl start harublog-web; systemctl is-active harublog-web
REMOTE
```

## 传图（媒体）链路：sharp + MinIO（2026-06-13 已打通）

传图依赖两件事，曾经两个都缺，现已修复并端到端验证（编辑器传图 → webp+派生 → MinIO → `/api/media` 出图）：

**① sharp（图片处理）** — 真因不是「musl/glibc 混入」，而是 **Mac 上 pnpm 默认只装宿主（darwin）的原生包，没装服务器要的 linux-x64-glibc**：
- Next 把 `sharp` 列为 external，构建产物里 `apps/web/.next/node_modules/sharp-<hash>` 是个**符号链接** → `node_modules/.pnpm/sharp@0.35.0/node_modules/sharp`（pnpm store）。app 运行时 `import()` 走这条链；该 store 的 `@img` 缺 glibc libvips（`libvips-cpp.so.8.18.3`）→ dlopen 报「cannot open shared object file」。装到 `apps/web/node_modules` 或顶层都没用，external 链不走那里。
- **根治（已落地）：`package.json` 的 `pnpm.supportedArchitectures` 声明 `os:[current,linux] cpu:[current,x64] libc:[current,glibc]`**。`pnpm install` 自此会把 linux-x64-glibc 的 `@img/sharp-linux-x64`（addon `.node`）+ `@img/sharp-libvips-linux-x64`（`libvips-cpp.so.8.18.3`）一并拉进 store。于是**任何会随包带上 `node_modules` 的部署（path-B / 全新机）天然装对 sharp，无需手工补丁**。本地 darwin 二进制仍在，本机 dev 不受影响。
- **path-A 注意**：JS-only 不动 `node_modules`，依赖服务器现有 store 已是对的。testblog 现有 store 已经修好（与 supportedArchitectures 装出的是同一套官方二进制），故 path-A 持续可用；下次 path-B 会用 supportedArchitectures 的产物把它规整成标准 pnpm 结构。
- **应急兜底**（万一某次部署落了坏 sharp）：服务器 glibc 原生取正确 `@img` 覆盖进 store——
  ```bash
  T=$(mktemp -d); (cd $T && npm init -y >/dev/null && npm install sharp@0.35.0 --os=linux --cpu=x64 --libc=glibc --no-audit --no-fund)
  S=/opt/harublog/web/node_modules/.pnpm/sharp@0.35.0/node_modules
  rm -rf "$S/@img"; cp -R "$T/node_modules/@img" "$S/@img"; systemctl restart harublog-web
  # （注意：不能在 app 目录直接 npm install sharp，会因 workspace:* 报 EUNSUPPORTEDPROTOCOL）
  ```

**② 对象存储 MinIO** — 服务器**从未部署过**对象存储（且无 docker），现以 systemd 原生二进制补齐：
```bash
# 二进制（dl.min.io 对服务器很慢——在本机下好再 scp 上去）
# 本机：curl -fL -o minio https://dl.min.io/server/minio/release/linux-amd64/minio ; 同理 mc ; scp 到 /usr/local/bin
install -m755 /tmp/minio.linux-amd64 /usr/local/bin/minio; install -m755 /tmp/mc.linux-amd64 /usr/local/bin/mc
mkdir -p /opt/harublog/minio-data
( umask 077; printf 'MINIO_ROOT_USER=%s\nMINIO_ROOT_PASSWORD=%s\n' "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY" > /opt/harublog/minio.env )
# 单元 /etc/systemd/system/harublog-minio.service：ExecStart=/usr/local/bin/minio server /opt/harublog/minio-data --address 127.0.0.1:9000 --console-address 127.0.0.1:9001
#   EnvironmentFile=/opt/harublog/minio.env, MemoryMax=320M, Restart=on-failure
systemctl daemon-reload && systemctl enable --now harublog-minio
/usr/local/bin/mc alias set hb http://127.0.0.1:9000 "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"
/usr/local/bin/mc mb --ignore-existing hb/harublog-media   # 私有桶；外界仅经 /api/media 代理读
```
内存占用约 70MB（封顶 320M），不抢占邻居。

## 测试账号（供测试人员，免验证码/2FA 直登）

密码统一 `Test2026demo`：`admin-test` / `editor-test` / `senior-test` / `junior-test`（均 `@harublog.dev`），分别对应 管理员 / 编辑 / 高级协作 / 初级协作 四档权限。

## 凭据与访问（不入库，仅本地）

- SSH：私钥 `~/.ssh/harublog_deploy`（`root@119.23.77.86`）。
- 应用密钥（DBPASS / AUTHSECRET）：本地 `/tmp/harublog-deploy-secrets.txt`；服务器侧已写入 `/opt/harublog/web.env`。
- root 密码与服务器 IP 等敏感信息只在对话/本地，**不提交进仓库**。
