-- 0002_uid_date_unique.sql — ICS 去重的唯一约束(同 UID 同一天只允许一条)
CREATE UNIQUE INDEX IF NOT EXISTS idx_todos_uid_date ON todos(uid, date_key);
