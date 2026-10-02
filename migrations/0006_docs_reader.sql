-- v0.5.0:项目重构为「只读文档阅读器」,健康日志业务整体退役。
-- 只保留访问码锁所需的两张表:settings(存 lock.salt / lock.hash)、auth_sessions(会话哈希)。
-- 幂等:DROP TABLE IF EXISTS,重复执行安全。
-- 注意:DROP TABLE 会连带删除该表上的索引,所以不必再单独 DROP INDEX。

DROP TABLE IF EXISTS health_logs;
DROP TABLE IF EXISTS day_logs;
DROP TABLE IF EXISTS weight_logs;
DROP TABLE IF EXISTS ai_summaries;
DROP TABLE IF EXISTS profile;
DROP TABLE IF EXISTS todos;
