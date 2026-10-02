-- ============================================================
-- v0.5.0 远端重构:退役健康日志业务,只保留访问码锁所需的两张表
--
-- 执行位置:Cloudflare 控制台 → D1 → mycal_db → Console(整段粘贴执行)
-- 执行次数:可重复执行(全部 IF EXISTS,幂等)
--
-- 背景:项目已从「私人 AI 健康日志」重构为「只读文档阅读器」。
-- 业务数据表(打卡/流水/体重/档案/AI 汇总)不再有任何代码读写,
-- 留着只会让新代码的 schema 与历史漂移,所以一次性清掉。
--
-- 保留:
--   settings      —— 存 lock.salt / lock.hash,访问码本身
--   auth_sessions —— 存会话 token 的 SHA-256,删表即可撤销所有设备
-- 清空 auth_sessions 会让所有已解锁设备重新要求输入访问码;
-- 想彻底重置访问码,再删 settings 里 lock.salt / lock.hash 两行(见 解锁码重置.sql)。
-- ============================================================

DROP TABLE IF EXISTS health_logs;
DROP TABLE IF EXISTS day_logs;
DROP TABLE IF EXISTS weight_logs;
DROP TABLE IF EXISTS ai_summaries;
DROP TABLE IF EXISTS profile;
DROP TABLE IF EXISTS todos;

-- 顺带清掉 AI 配置残留(新版代码完全不再读取这些 key)
DELETE FROM settings WHERE key IN ('ai.baseUrl', 'ai.model', 'ai.apiKey');

-- 校验:执行后应只剩 settings 与 auth_sessions 两张表
SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;
