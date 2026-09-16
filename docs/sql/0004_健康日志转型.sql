-- ============================================================
-- MyCal v0.4 · 健康日志转型 —— 远端 D1 迁移脚本
-- 请在 Cloudflare 网页 D1 Console(mycal_db)执行。
-- 全部语句幂等,重复执行安全;与 migrations/0004_journal_lock_weight.sql 等价。
-- ============================================================

-- 当日流水:记录"今天做了哪些事",多条时间序,供 AI 汇总消化
CREATE TABLE IF NOT EXISTS day_logs (
  id         TEXT PRIMARY KEY,
  date_key   TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_day_logs_date ON day_logs(date_key);

-- 体重记录:一天一条,同日再录即覆盖(口径:晨起空腹)
CREATE TABLE IF NOT EXISTS weight_logs (
  date_key   TEXT PRIMARY KEY,
  weight_kg  REAL NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 登录会话:只存访问码解锁后签发的随机 token 的 SHA-256;「立即上锁」= 清空本表
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  label      TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- 访问码哈希与防爆破计数存于既有 settings 表(运行时自动写入,此处无需建表):
--   lock.salt / lock.hash —— PBKDF2 派生用盐与哈希
--   lock.fails            —— 连续失败次数与冷却截止时间(JSON)

-- 待办退役:旧手动待办数据不再需要,清空;todos 表从此只服务 ICS 日程
DELETE FROM todos WHERE source IS NULL OR source <> 'ics';

-- 执行后自检(可选):
-- SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
