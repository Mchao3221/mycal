# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

MyCal —「日历 + 每日待办 + 打卡日记」Web 应用。前端 Vite 8 + React 18 + TS(严格模式)+ Tailwind v4 + daisyUI 5;后端为 Cloudflare Worker(`worker/`,自写轻路由、无框架),数据存 Cloudflare D1(SQLite);v0.3.1 起有打卡日记 + AI 每日热量汇总(OpenAI 兼容,结合健康档案 BMR/TDEE)。规划与交互设计详见 `PLAN.md` 与 `README.md`(均为中文,提交信息也用中文)。

## 常用命令

```bash
pnpm install            # 包管理器是 pnpm v11(packageManager 字段固定),不要用 npm
pnpm run dev            # 开发:http://localhost:5173,Vite 内嵌运行 worker,/api 同源无需代理
pnpm db:migrate:local   # 应用迁移到本地 D1(miniflare,数据在 .wrangler/state)——首次/改表后必跑
pnpm run build          # 先 tsc --noEmit 检查两个 tsconfig,再 vite build(不连接数据库)
pnpm run preview        # 构建后用 wrangler dev 本地预览生产形态
pnpm run deploy         # build → 远端 D1 迁移 → wrangler deploy(顺序有保证,勿拆开手动执行)
```

无测试框架;`pnpm run build` 里的双 `tsc --noEmit` 是唯一的静态检查手段。

## 架构要点

- **两套 tsconfig、两个运行环境**:`tsconfig.json` 编译 `src/`(浏览器 + DOM),`tsconfig.worker.json` 编译 `worker/`(Cloudflare Workers 类型)。前后端不共享代码;新增全局类型需改对应 env.d.ts(`worker/env.d.ts` 声明 D1 绑定 `mycalDB`)。
- **Worker 无框架路由**:`worker/index.ts` 的 `fetch` 入口用正则 + method 匹配处理 `/api/*`,未匹配的请求落到 SPA 静态资产回退(`wrangler.jsonc` 的 `not_found_handling`)。改 API 时保持这个模式。
- **表结构唯一事实源是 `migrations/*.sql`**:代码里没有任何建表语句。改表必须新增 `000N_描述.sql` 增量迁移(不重写历史),`pnpm db:migrate:local` 本地验证;build 不连库,结构漂移只在运行时暴露。
- **单表双用途**:`todos` 表同时存手动待办(`source` 为 NULL)和 ICS 导入的日程(`source='ics'`)。ICS 去重靠唯一索引 `(uid, date_key)` + `INSERT OR IGNORE`(`worker/db.ts` 的 `insertIcsTodos`,据此统计 imported/duplicates;D1 batch 按 50 条分块)。
- **前端数据流**:`src/hooks/useTodos.ts`(待办/日程)与 `src/hooks/useHealth.ts`(打卡日记)各拉一次全量 `Record<'YYYY-MM-DD', T[]>` 后本地分发;共享 fetch 封装在 `src/utils/api.ts`(非 2xx 抛后端 `{ error }`)。`App.tsx` 按 `source` 拆待办/日程两路,打卡走独立 `/api/health`,合算日历圆点(蓝=日程,琥珀=待办,绿=打卡)。
- **打卡热量三态与 AI 汇总**:单条 `kcal` 为 NULL=待估 / `kcal_source='ai'`=AI 估算 / `'manual'`=手动;`worker/ai.ts` 估算**只回填空值,不覆盖手动**。BMR/TDEE 在 `worker/ai.ts` 用 Mifflin-St Jeor 服务端确定性计算,AI 只负责估单条热量 + 写点评,汇总按天缓存于 `ai_summaries`。
- **AI 服务配置**:OpenAI 兼容 `/chat/completions`。优先级 `settings` 表 > 环境变量 `AI_BASE_URL/AI_API_KEY/AI_MODEL`(生产用 `wrangler secret put AI_API_KEY`)> 默认值。**API Key 只写不读**(GET `/api/ai/config` 仅返回 `hasKey`)。
- **日期计算无库**:`src/utils/date.ts` 自写;`worker/ics.ts` 也是自写 ICS 解析器。
- **Workers 无本机时区**:worker 侧时间统一按 UTC 墙钟处理(`worker/ics.ts` 的 `dateKeyOf` 用 getUTC*),导入窗口为今天(UTC)±365 天,RRULE 不展开仅计数 —— 改动时间逻辑时保持这个约定。

## 其他约定

- UI 文案、注释、错误消息均为中文,新增代码保持一致。
- 主题切换用 daisyUI 的 `data-theme`(`mycal` 浅色 / `dim` 深色),记忆在 localStorage。
- `docs/sample.ics` 是 ICS 导入的本地测试样例。
