-- v0.6.0:仓库同步架构。阅读路径不再实时回源 Gitee,改成先把仓库同步进 D1,之后只读本地副本。
--
-- 为什么这么设计:
--   1. 实时回源把「Cloudflare 到 Gitee 的链路质量」变成了每次打开文件的体验,链路一慢整站就慢;
--   2. 同步是一次性的批量操作,慢一点可以接受,而读路径必须快且稳定;
--   3. 顺带为以后的全文搜索留了地方。
--
-- 为什么是 D1 而不是 R2/KV:项目本来就绑定了 D1,不需要额外开通服务;配额(免费 5GB 存储、
--   10 万行写入/天)对 ~830 个文件、~9MB 的内容完全够用。

-- 文件清单:一行一个文件,sha 是它在 git 里的 blob 哈希。
-- 只按 sha 判断是否需要重新拉取 —— 内容没变就一个字节都不写。
CREATE TABLE IF NOT EXISTS doc_files (
  path       TEXT PRIMARY KEY,
  sha        TEXT NOT NULL,
  size       INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doc_files_sha ON doc_files(sha);

-- 内容:按 sha 内容寻址 + 分块。
--   内容寻址 → 同一份内容被多个路径引用时只存一份;重复同步天然幂等;
--   分块 → 单行有大小上限,最大的文件是 2.4MB 的 epub,不分块塞不进去。
-- 存 BLOB 而不是 base64 文本:省 33% 空间,而且读的时候不用解码。
CREATE TABLE IF NOT EXISTS doc_blobs (
  sha  TEXT NOT NULL,
  seq  INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (sha, seq)
) WITHOUT ROWID;

-- 同步元信息:最近一次同步的 rev / 时间 / 文件数,用于前端展示与增量判断。
CREATE TABLE IF NOT EXISTS doc_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
