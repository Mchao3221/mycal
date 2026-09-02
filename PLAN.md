# MyCal — 日常工作台 · 项目规划

> 一个「日历 + 每日待办」的本地 Web 应用:看月历,点哪天,就管哪天的事。
> v0.2 起数据存本地 **SQLite**,并支持 **导入 .ics 订阅链接**。

## 1. 项目目标

- **月历视图**:按月展示,翻上/下月,一键回到今天;
- **点击某天 → 当天待办列表**:添加、勾选完成、删除;
- **数据存本地 SQLite**:不依赖浏览器存储,关浏览器、换浏览器都不丢;
- **ICS 订阅导入**:粘贴日历订阅链接,日程按日期自动铺进日历;
- **轻量、快、完全本地运行**。

## 2. 功能范围

| 模块 | 功能点 |
| --- | --- |
| 日历 | 月视图网格(周一打头)、上/下月切换、回到今天 |
| 日历 | 「今天」高亮、选中日高亮、双圆点标记(蓝=日程,琥珀=待办,可并存) |
| 当日面板 | **待办 / 日程双 Tab 分离列表**(不混排)、完成度进度条、周数、空状态 |
| 待办 Tab | 添加(回车/按钮)、勾选完成/取消、删除;自定义复选框 |
| 日程 Tab | 时间轴样式(时刻 + 竖条)、全天归档显示、可移除单条日程 |
| ICS 导入 | **Ctrl+I 或顶栏「订阅」呼出弹窗** → 提交后弹窗立即关闭 → 后台导入 → Toast 提示结果 |
| ICS 去重 | 同一 UID 在同一天只入库一次,重复导入同一链接零副作用 |
| 持久化 | SQLite(`data/mycal.db`),经 REST API 读写,前端不存业务数据 |
| 主题 | Tailwind v4 + daisyUI 5;自定义浅色主题 + dim 深色,顶栏按钮切换 |
| 布局 | 按 1920×1080 设计:双栏铺满全宽(超宽屏上限 1920),列表区独立滚动;sticky 毛玻璃顶栏 |

### 已知边界(个人日常够用,列为 v2 增强)

- RRULE 重复规则**不展开**:跳过并在导入结果中计数提示;
- TZID/浮动时间按**本地墙钟**近似(不做时区库换算);
- 导入窗口为今天 ±365 天,单次最多 500 条,多日事件最多铺 30 天;
- 导入是手动触发,暂无定时自动同步。

## 3. 技术方案

- **前端**:Vite 5 + React 18 + TypeScript(严格模式),原生 CSS,无 UI 库;
- **后端**:Node ≥ 22.5 + **Express 5** + **内置 `node:sqlite`**(零原生编译依赖);
- **数据库**:SQLite 单文件 `data/mycal.db`,默认日志模式,个人规模无压力;
- **开发模式**:`concurrently` 同起两个进程,Vite 把 `/api` 代理到后端;
- **日期计算**:前端自写 `src/utils/date.ts`(无日期库);ICS 解析自写 `server/ics.mjs`。

### 数据模型(SQLite)

```sql
CREATE TABLE todos (
  id         TEXT PRIMARY KEY,   -- uuid
  date_key   TEXT    NOT NULL,   -- 'YYYY-MM-DD'
  text       TEXT    NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  source     TEXT,               -- NULL=本地待办, 'ics'=订阅日程
  uid        TEXT                -- ICS 事件 UID,用于去重
);
CREATE INDEX idx_todos_date ON todos(date_key);
CREATE INDEX idx_todos_uid  ON todos(uid);
```

### REST API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/todos` | 全量:`{ "YYYY-MM-DD": Todo[] }` |
| POST | `/api/todos` | 添加:`{ dateKey, text }` → Todo |
| POST | `/api/todos/:id/toggle` | 切换完成态 → Todo |
| DELETE | `/api/todos/:id` | 删除 → `{ ok }` |
| POST | `/api/ics/import` | 导入:`{ url }` → `{ fetchedEvents, imported, duplicates, skippedRecurring, outOfWindow }` |

### ICS 导入策略

1. 服务端拉取 URL(15s 超时,跟随重定向),解析 VEVENT;
2. 支持:行折叠、`VALUE=DATE` 全天、UTC(`Z`)按本机时区落日期、`TZID`/浮动时间按本地墙钟、多日全天事件逐日铺开(上限 30 天);
3. `RRULE` 重复事件跳过并计数;窗口(±365 天)外跳过;
4. 去重键 = `uid + date_key`,同一订阅可反复导入刷新。

## 4. 目录结构

```
mycal/
├── PLAN.md                    # 本文档
├── index.html / package.json / tsconfig.json / vite.config.ts
├── data/                      # SQLite 数据库(gitignore)
│   └── mycal.db
├── docs/
│   ├── ui-sketch.excalidraw   # 界面手绘草图(原生 .excalidraw 格式)
│   └── sample.ics             # ICS 导入测试样例
├── scripts/
│   └── build-sketch.mjs       # 重新生成草图:npm run sketch
├── server/
│   ├── index.mjs              # Express:REST API + 托管 dist
│   ├── db.mjs                 # node:sqlite 建表与 CRUD
│   └── ics.mjs                # ICS 解析/展开
└── src/
    ├── main.tsx / App.tsx
    ├── types.ts               # Todo / TodoStore / DotKind
    ├── utils/date.ts          # 月矩阵、日期 key
    ├── hooks/useTodos.ts      # 经 REST API 读写待办
    └── components/
        ├── Calendar.tsx  DayCell.tsx
        ├── DayPanel.tsx       # 当日条目(含 ICS 徽标)
        └── ImportBar.tsx      # .ics 链接导入条
```

## 5. 交互设计

1. 打开应用 → 默认当月、选中今天,自动从后端加载数据;
2. 点任意日期 → 右侧面板切换为该天;
3. **待办与日程分 Tab 展示**:待办 Tab 勾选/添加/删除;日程 Tab 只读时间轴;
4. **Ctrl+I(或顶栏「订阅」)→ 弹窗粘贴 .ics 链接 → 导入** → 弹窗立即关闭,后台拉取解析,完成后 Toast 提示「成功导入 n 条 · 跳过重复 n 条」;
5. 日历圆点:蓝 = 有日程,琥珀 = 有待办,两种可同时出现;选中日圆点变白;
6. 顶栏月亮/太阳按钮切换深浅色主题(记忆在 localStorage)。

## 6. 启动方式

```bash
npm install

# 开发:同起 API(3001) + Vite(5173,已配 /api 代理)
npm run dev

# 生产:构建后单进程(3001 同时供 API 与静态页面)
npm run build
npm start            # http://127.0.0.1:3001
```

试试导入:把 `docs/sample.ics` 用任意静态服务暴露后粘贴链接(或直接用真实订阅 URL)。

## 7. 里程碑

1. ✅ v0.1:规划 → Excalidraw 草图 → 日历+待办(localStorage 版)
2. ✅ v0.2:SQLite 持久化 + REST API 后端;ICS 订阅导入(解析/去重/多日展开);草图归档为 `docs/ui-sketch.excalidraw`
3. ✅ E2E 验证 16 项:CRUD、参数校验、ICS 全类型事件(全天/UTC/TZID/多日/RRULE/折叠行/窗口外)、重复导入去重、错误路径、Vite 代理、页面可用
4. ⬜ v2 候选:订阅定时自动同步、RRULE 展开、待办文字编辑、优先级、导出 JSON 备份
