#!/usr/bin/env bash
# 从 custom 格式备份恢复到目标库（会先清理同名对象）。恢复后须重建搜索索引（worker reindex）。
# 用法：TARGET_URL=postgres://... ./restore.sh <备份文件.dump>
set -euo pipefail

URL="${TARGET_URL:?需要 TARGET_URL}"
FILE="${1:?需要备份文件路径}"
[ -f "$FILE" ] || { echo "找不到备份文件：$FILE" >&2; exit 1; }

pg_restore --clean --if-exists --no-owner --no-privileges -d "$URL" "$FILE"
echo "恢复完成 ← $FILE"
echo "提醒：恢复后运行 'pnpm --filter @harublog/worker reindex' 重建搜索索引。"
