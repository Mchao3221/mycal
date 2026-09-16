-- 0005_drop_schedule.sql — 日程功能整体退役:
-- 删除 todos 表(其唯一历史用途是手动待办与 ICS 日程,均已被用户确认弃用)。
-- 幂等:DROP TABLE IF EXISTS,重复执行安全。
DROP TABLE IF EXISTS todos;
