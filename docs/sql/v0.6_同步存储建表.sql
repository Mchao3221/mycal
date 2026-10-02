-- ============================================================
-- v0.6.0 远端迁移:新增同步存储的三张表
--
-- 执行位置:Cloudflare 控制台 → D1 → mycal_db → Console(整段粘贴执行)
-- 执行次数:可重复执行(全部 IF NOT EXISTS,幂等)
--
-- 背景:阅读路径从「实时回源 Gitee」改成「先同步进 D1,之后只读本地副本」。
-- 这张脚本与 migrations/0007_doc_store.sql 内容一致;
-- 如果 Cloudflare 的 GitHub 集成会自动跑迁移,则本脚本可不执行(重复执行也无害)。
-- ============================================================

CREATE TABLE IF NOT EXISTS doc_files (
  path       TEXT PRIMARY KEY,
  sha        TEXT NOT NULL,
  size       INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doc_files_sha ON doc_files(sha);

CREATE TABLE IF NOT EXISTS doc_blobs (
  sha  TEXT NOT NULL,
  seq  INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (sha, seq)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS doc_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 校验:应当能看到 doc_files / doc_blobs / doc_meta 三张表
SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'doc_%' ORDER BY name;
