-- 2026-09-05_remote_d1_fix.sql
-- 用途:在 Cloudflare 网页 D1 Console(mycal_db)一次性执行。
-- 背景:早期手动部署时用旧版迁移建过表,导致
--   1) 缺少 0002 迁移的 ICS 去重唯一索引;
--   2) d1_migrations 账本里旧 0001 的校验和与仓库新文件不一致,
--      CI 跑 `pnpm run deploy`(含远端迁移)会报 "modified migrations" 而中断。
-- 仓库内所有迁移均带 IF NOT EXISTS,清空账本后重放是幂等的,不会丢数据。

CREATE UNIQUE INDEX IF NOT EXISTS idx_todos_uid_date ON todos(uid, date_key);
DELETE FROM d1_migrations;
