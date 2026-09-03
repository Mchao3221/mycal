# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

MyCal —「日历 + 每日待办」Web 应用。前端 Vite 8 + React 18 + TS(严格模式)+ Tailwind v4 + daisyUI 5;后端为 Cloudflare Worker(`worker/`,自写轻路由、无框架),数据存 Cloudflare D1(SQLite)。规划与交互设计详见 `PLAN.md` 与 `README.md`(均为中文,提交信息也用中文)。

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
- **前端数据流**:`src/hooks/useTodos.ts` 经 REST API 读写,GET `/api/todos` 全量拉取 `Record<'YYYY-MM-DD', Todo[]>` 后纯前端分发给 Calendar / DayPanel;`App.tsx` 里按 `source` 拆成待办/日程两路并计算圆点标记。
- **日期计算无库**:`src/utils/date.ts` 自写;`worker/ics.ts` 也是自写 ICS 解析器。
- **Workers 无本机时区**:worker 侧时间统一按 UTC 墙钟处理(`worker/ics.ts` 的 `dateKeyOf` 用 getUTC*),导入窗口为今天(UTC)±365 天,RRULE 不展开仅计数 —— 改动时间逻辑时保持这个约定。

## 其他约定

- UI 文案、注释、错误消息均为中文,新增代码保持一致。
- 主题切换用 daisyUI 的 `data-theme`(`mycal` 浅色 / `dim` 深色),记忆在 localStorage。
- `docs/sample.ics` 是 ICS 导入的本地测试样例。
