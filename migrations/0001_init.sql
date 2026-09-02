-- 0001_init.sql — 初始表结构
CREATE TABLE IF NOT EXISTS todos (
  id         TEXT PRIMARY KEY,
  date_key   TEXT    NOT NULL,
  text       TEXT    NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  source     TEXT,
  uid        TEXT
);
CREATE INDEX IF NOT EXISTS idx_todos_date ON todos(date_key);
CREATE INDEX IF NOT EXISTS idx_todos_uid  ON todos(uid);
