# MyCal — 日常工作台

一个「日历 + 每日待办」的本地 Web 应用：看月历，点哪天，就管哪天的事。

- 📅 **月历视图**：按月展示、上/下月切换、一键回到今天，「今天」与选中日高亮；
- ✅ **待办 / 日程双 Tab**：待办可添加（回车/按钮）、勾选完成、删除；日程以时间轴样式展示，可移除单条；
- 🔵🟡 **圆点标记**：蓝 = 有日程，琥珀 = 有待办，可并存；
- 📥 **ICS 订阅导入**：`Ctrl+I` 或顶栏「订阅」呼出弹窗，粘贴订阅链接即可把日程按日期铺进日历，重复导入零副作用（同 UID 同一天只入库一次）；
- 💾 **SQLite 持久化**：数据存本地 `data/mycal.db`，经 REST API 读写，不依赖浏览器存储；
- 🌗 **深浅色主题**：Tailwind v4 + daisyUI 5，自定义浅色主题 + dim 深色，一键切换（记忆在 localStorage）。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | Vite + React 18 + TypeScript（严格模式），Tailwind CSS v4 + daisyUI 5 |
| 后端 | Node ≥ 22.5 + Express 5 + 内置 `node:sqlite`（零原生编译依赖） |
| 数据库 | SQLite 单文件 `data/mycal.db` |
| 日期计算 | 自写 `src/utils/date.ts`，无日期库 |
| ICS 解析 | 自写 `server/ics.mjs`（行折叠 / 全天 / UTC / TZID / 多日展开） |

## 环境要求

- **Node.js ≥ 22.5**（后端使用内置 `node:sqlite`）
- [pnpm](https://pnpm.io/)（项目内脚本统一按 pnpm 编写）

## 快速开始

```bash
pnpm install

# 开发模式:同起 API 服务器(3001) + Vite(5173,/api 已代理)
pnpm run dev
# 打开 http://localhost:5173

# 生产模式:构建后单进程,3001 同时提供 API 与静态页面
pnpm run build
pnpm start          # http://127.0.0.1:3001
```

其他脚本：

| 命令 | 说明 |
| --- | --- |
| `pnpm run dev:server` / `pnpm run dev:client` | 单独启动后端 / 前端 |
| `pnpm run css` | 从 `styles/workbench.css` 重新构建原型页样式 `assets/workbench.css` |
| `pnpm run sketch` | 重新生成手绘草图 `docs/ui-sketch.excalidraw` |
| `PORT=8080 pnpm start` | 自定义后端端口（默认 3001） |

## ICS 订阅导入

顶栏「订阅」按钮或 `Ctrl+I` 打开导入弹窗，粘贴 `http(s)` 的 `.ics` 链接提交后，后台拉取并解析，完成后 Toast 提示结果（成功导入 / 重复跳过 / 重复规则跳过等计数）。

当前支持的解析能力与边界：

- 支持行折叠、`VALUE=DATE` 全天事件、UTC（`Z`）按本机时区落日期、`TZID`/浮动时间按本地墙钟近似、多日全天事件逐日铺开（上限 30 天）；
- `RRULE` 重复规则**不展开**，跳过并在结果中计数提示；
- 导入窗口为今天 ±365 天，单次最多 500 条；
- 去重键 = `uid + date_key`，同一订阅可反复导入刷新，零副作用。

本地测试可直接使用 [`docs/sample.ics`](docs/sample.ics)：用任意静态服务暴露该文件后把链接粘贴进弹窗即可。

## REST API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/todos` | 全量获取:`{ "YYYY-MM-DD": Todo[] }` |
| POST | `/api/todos` | 添加:`{ dateKey, text }` → Todo |
| POST | `/api/todos/:id/toggle` | 切换完成态 → Todo |
| DELETE | `/api/todos/:id` | 删除 → `{ ok }` |
| POST | `/api/ics/import` | 导入:`{ url }` → `{ fetchedEvents, imported, duplicates, skippedRecurring, outOfWindow }` |

数据模型见 [`PLAN.md`](PLAN.md)（`todos` 表，`source` 区分本地待办与 ICS 订阅日程）。

## 项目结构

```
mycal/
├── index.html / vite.config.ts / tsconfig.json
├── mycal-daily-workbench.html   # 静态 UI 原型页（pnpm run css 重建其样式）
├── data/                        # SQLite 数据库 mycal.db（gitignore）
├── docs/
│   ├── ui-sketch.excalidraw     # 界面手绘草图
│   └── sample.ics               # ICS 导入测试样例
├── scripts/
│   └── build-sketch.mjs         # 重新生成草图（pnpm run sketch）
├── server/
│   ├── index.mjs                # Express:REST API + 托管 dist
│   ├── db.mjs                   # node:sqlite 建表与 CRUD
│   └── ics.mjs                  # ICS 解析/展开
├── src/
│   ├── main.tsx / App.tsx
│   ├── types.ts                 # Todo / TodoStore / DotKind
│   ├── utils/date.ts            # 月矩阵、日期 key
│   ├── hooks/useTodos.ts        # 经 REST API 读写待办
│   └── components/              # Calendar / DayCell / DayPanel / ImportModal / Toasts
├── styles/workbench.css         # 原型页 Tailwind 源样式
└── wrangler.jsonc               # Cloudflare Workers/D1 部署配置
```

## 部署（Cloudflare，可选）

仓库包含 `wrangler.jsonc`（Workers + D1 绑定 `mycalDB` + 静态资源 SPA 回退），并预留：

```bash
pnpm run deploy    # pnpm run build && wrangler deploy
pnpm run preview   # pnpm run build && wrangler dev
```

> 当前日常主路径仍是本地 Node 服务器 + SQLite；Cloudflare/D1 链路为实验性，尚未接入业务代码。

## 路线图

- ✅ v0.1：规划 → Excalidraw 草图 → 日历 + 待办（localStorage 版）
- ✅ v0.2：SQLite 持久化 + REST API；ICS 订阅导入（解析/去重/多日展开）；E2E 验证 16 项
- ⬜ v2 候选：订阅定时自动同步、RRULE 展开、待办文字编辑、优先级、导出 JSON 备份

更完整的规划与交互设计见 [`PLAN.md`](PLAN.md)。
