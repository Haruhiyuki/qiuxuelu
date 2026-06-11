# 备份与恢复运维手册

> 目标（架构 §9 M5 验收红线）：**RTO < 1 小时，RPO < 5 分钟。**

## 真相源与可重建组件

| 组件 | 是否真相源 | 灾难恢复方式 |
|------|-----------|-------------|
| PostgreSQL | **是（唯一真相源）** | 逻辑备份 + WAL 归档恢复 |
| Meilisearch | 否（索引派生） | `pnpm --filter @harublog/worker reindex` 从 PG 全量重建 |
| Yjs / Hocuspocus | 否（热缓存） | 无状态；从草稿修订重新 seed（见 ADR / §6.3） |
| 上传媒体（M5+ 接入对象存储后） | 是 | 对象存储自身多副本 + 跨区复制 |

结论：**只需备份 PostgreSQL**，其余皆可从它重建。

## RPO < 5 分钟：连续归档

- 开启 PostgreSQL WAL 归档（`archive_mode=on` + `archive_command` 推送到对象存储），实现接近连续的时间点恢复（PITR），RPO 取决于 WAL 段切换频率（设 `archive_timeout=60s` 可把 RPO 压到分钟级）。
- 兜底：定时逻辑备份 `infra/backup/backup.sh`（建议每日 + 关键操作前手动一次）。

```bash
# 逻辑备份（custom 格式）
DATABASE_URL=postgres://harublog:harublog@HOST:5432/harublog \
  infra/backup/backup.sh /var/backups/harublog
```

## RTO < 1 小时：恢复步骤

1. 置备一台 PostgreSQL（容器或托管实例），创建空库 `harublog`。
2. 恢复最近一次逻辑备份（或 PITR 到目标时间点）：

   ```bash
   TARGET_URL=postgres://harublog:harublog@NEWHOST:5432/harublog \
     infra/backup/restore.sh /var/backups/harublog/harublog-<ts>.dump
   ```

3. 指向新库重启 web / worker / collab（更新 `DATABASE_URL`）。
4. 重建搜索索引（不阻塞读写，可后台进行）：

   ```bash
   pnpm --filter @harublog/worker reindex
   ```

5. 验收：抽查若干文章页、`/transparency` 计数、`/api/export/<slug>`。

数据库恢复（分钟级）+ 应用切换（分钟级）远小于 1 小时；搜索重建可在恢复读写后台进行，不计入 RTO。

## 演练

每季度执行一次「备份 → 恢复到临时库 → 校验行数一致」的演练（见 CI/cron 或手动）；
本仓库已用 `harublog_restore_test` 临时库验证过恢复链路（备份→恢复→核心表行数一致）。
