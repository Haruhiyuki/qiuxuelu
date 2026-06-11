#!/usr/bin/env bash
# PostgreSQL 逻辑备份（custom 格式，可并行恢复）。PG 是唯一真相源——Meilisearch 可重建、
# collab/Yjs 无状态，故只需备份 PG。RPO 由备份频率 + WAL 归档决定（见 runbook）。
# 用法：DATABASE_URL=postgres://... ./backup.sh [输出目录]
set -euo pipefail

URL="${DATABASE_URL:?需要 DATABASE_URL}"
OUT_DIR="${1:-./backups}"
mkdir -p "$OUT_DIR"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$OUT_DIR/harublog-$TS.dump"

pg_dump --format=custom --no-owner --no-privileges "$URL" -f "$FILE"
echo "备份完成：$FILE ($(du -h "$FILE" | cut -f1))"
