# MyCal — 日常工作台

一个「日历 + 每日待办」的 Web 应用:看月历,点哪天,就管哪天的事。

- 📅 **月历视图**:按月展示、上/下月切换、一键回到今天,「今天」与选中日高亮;
- ✅ **待办 / 日程双 Tab**:待办可添加(回车/按钮)、勾选完成、删除;日程以时间轴样式展示,可移除单条;
- 🔵🟡 **圆点标记**:蓝 = 有日程,琥珀 = 有待办,可并存;
- 📥 **ICS 订阅导入**:`Ctrl+I` 或顶栏「订阅」呼出弹窗,粘贴订阅链接即可把日程按日期铺进日历,重复导入零副作用(同 UID 同一天只入库一次);
- ☁️ **Cloudflare Workers + D1**:前端与 API 一体部署,数据存 D1(SQLite),表结构由迁移文件管理;
- 🌗 **深浅色主题**:Tailwind v4 + daisyUI 5,自定义浅色主题 + dim 深色,一键切换(记忆在 localStorage)。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | Vite 8 + React 18 + TypeScript(严格模式),Tailwind CSS v4 + daisyUI 5 |
| 后端 | Cloudflare Worker(`worker/index.ts`,自写轻路由,无框架依赖) |
| 数据库 | Cloudflare D1(SQLite),表结构由 `migrations/*.sql` 管理 |
| 日期计算 | 自写 `src/utils/date.ts`,无日期库 |
| ICS 解析 | 自写 `worker/ics.ts`(行折叠 / 全天 / UTC / TZID / 多日展开) |

## 环境要求

- **Node.js ≥ 20**(构建工具链)
- [pnpm](https://pnpm.io/) v11
- Cloudflare 账号(部署/远端 D1 需要,`wrangler login`)

## 快速开始

```bash
pnpm install

# 1) 应用迁移到本地 D1(miniflare,数据落在 .wrangler/state)
pnpm db:migrate:local

# 2) 开发:Vite 内嵌运行 worker,/api 与页面同源
pnpm run dev
# 打开 http://localhost:5173
```

## 表结构管理(重要)

**表结构的唯一事实源是 `migrations/` 目录下的 SQL 文件**,代码里没有任何建表语句:

1. 需要改表时,新增一个 `migrations/000N_描述.sql`(只写增量,不重写历史);
2. `pnpm db:migrate:local` 在本地验证;
3. `pnpm run deploy` 会自动先对远端 D1 应用未执行的迁移,再发布 Worker;
4. wrangler 用 `d1_migrations` 表记录已应用版本,重复执行安全。

```bash
pnpm db:migrate:local        # 本地应用
pnpm db:migrate:remote       # 远端应用(deploy 已内置)
npx wrangler d1 migrations list mycal_db --remote   # 部署前体检:查看未应用迁移
```

> ⚠️ 构建(`pnpm run build`)不连接数据库,结构漂移**不会**导致构建报错,只会在运行时暴露 —— 所以改表必须走迁移文件。

## 部署

```bash
pnpm run deploy
# 等价于: pnpm run build && wrangler d1 migrations apply mycal_db --remote && wrangler deploy
```

本地预览生产构建:`pnpm run preview`。

## ICS 订阅导入

顶栏「订阅」按钮或 `Ctrl+I` 打开导入弹窗,粘贴 `http(s)` 的 `.ics` 链接提交后,后台拉取并解析,完成后 Toast 提示结果(成功导入 / 重复跳过 / 重复规则跳过等计数)。

当前支持的解析能力与边界:

- 支持行折叠、`VALUE=DATE` 全天事件、UTC(`Z`)落日期、多日全天事件逐日铺开(上限 30 天);
- Workers 无本机时区,时间统一按 **UTC 墙钟**近似处理;
- `RRULE` 重复规则**不展开**,跳过并在结果中计数提示;
- 导入窗口为今天(UTC)±365 天,单次最多 500 条;
- 去重 = 数据库唯一索引 `(uid, date_key)` + `INSERT OR IGNORE`,同一订阅可反复导入刷新,零副作用。

本地测试可直接使用 [`docs/sample.ics`](docs/sample.ics):用任意静态服务暴露该文件后把链接粘贴进弹窗即可。


## REST API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/todos` | 全量获取:`{ "YYYY-MM-DD": Todo[] }` |
| POST | `/api/todos` | 添加:`{ dateKey, text }` → Todo |
| POST | `/api/todos/:id/toggle` | 切换完成态 → Todo |
| DELETE | `/api/todos/:id` | 删除 → `{ ok }` |
| POST | `/api/ics/import` | 导入:`{ url }` → `{ fetchedEvents, imported, duplicates, skippedRecurring, outOfWindow }` |

## 项目结构

```
mycal/
├── index.html / vite.config.ts / tsconfig.json / tsconfig.worker.json
├── wrangler.jsonc                # Workers + D1 绑定 + 迁移目录 + SPA 静态资产
├── migrations/                   # ★ 表结构唯一事实源
│   ├── 0001_init.sql             # todos 表 + 索引
│   └── 0002_uid_date_unique.sql  # ICS 去重唯一索引
├── worker/                       # ★ API 后端(跑在 Cloudflare Workers)
│   ├── index.ts                  # fetch 入口 + 路由
│   ├── db.ts                     # D1 查询(CRUD / 批量导入去重)
│   ├── ics.ts                    # ICS 解析/展开
│   ├── env.d.ts                  # D1 绑定类型
│   └── types.ts                  # Todo / TodoRow
├── src/                          # React 前端
│   ├── main.tsx / App.tsx / types.ts / utils/date.ts
│   ├── hooks/useTodos.ts         # 经 REST API 读写待办
│   └── components/               # Calendar / DayCell / DayPanel / ImportModal / Toasts
└── docs/
    └── sample.ics                # ICS 导入本地测试样例
```

## 路线图

- ✅ v0.1:规划 → 日历 + 待办(localStorage 版)
- ✅ v0.2:SQLite 持久化 + REST API;ICS 订阅导入;待办/日程双 Tab;Tailwind + daisyUI 重构
- ✅ v0.3:迁移到 Cloudflare Workers + D1;表结构改为迁移文件管理;deploy 前置远端迁移;清理原型页与草图生成器
- ⬜ v2 候选:订阅定时自动同步(Cron Triggers)、RRULE 展开、待办文字编辑、优先级、导出 JSON 备份

更完整的规划与交互设计见 [`PLAN.md`](PLAN.md)。
