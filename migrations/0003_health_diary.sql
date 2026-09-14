-- 0003_health_diary.sql — 打卡日记 + 健康档案 + AI 汇总 + 应用设置
CREATE TABLE IF NOT EXISTS health_logs (
  id          TEXT PRIMARY KEY,
  date_key    TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('diet','exercise')),
  text        TEXT NOT NULL,
  meal        TEXT,               -- 仅 diet:breakfast/lunch/dinner/snack
  kcal        INTEGER,            -- 千卡;NULL = 待 AI 估算
  kcal_source TEXT CHECK (kcal_source IN ('manual','ai')),
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_health_date ON health_logs(date_key);

-- 健康档案:全局单行(id=1),供 AI 结合身体情况评估
CREATE TABLE IF NOT EXISTS profile (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  sex              TEXT CHECK (sex IN ('male','female')),
  age              INTEGER,
  height_cm        REAL,
  weight_kg        REAL,
  target_weight_kg REAL,
  activity         TEXT,          -- sedentary/light/moderate/high(不含刻意运动)
  goal             TEXT,          -- lose/maintain/gain
  updated_at       INTEGER
);

-- AI 每日汇总:按天缓存 JSON,可删除后重新生成
CREATE TABLE IF NOT EXISTS ai_summaries (
  date_key   TEXT PRIMARY KEY,
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 应用设置:AI baseUrl / apiKey / model(key 仅存本机/本库,GET 接口不回显)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
