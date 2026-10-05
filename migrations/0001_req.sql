-- 需求管理 v0.1：多项目多需求，只存链接索引，不存文件本身。
-- 复用既有 D1（mycal_db），新表与旧表不冲突；旧 doc_* 表不动。

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS requirements (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_req_project ON requirements(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_req_status ON requirements(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS req_links (
  id TEXT PRIMARY KEY,
  req_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_link_req ON req_links(req_id);

-- 全文搜索：标题 + 正文 + 链接备注
CREATE VIRTUAL TABLE IF NOT EXISTS req_fts USING fts5(req_id UNINDEXED, title, body, note);
