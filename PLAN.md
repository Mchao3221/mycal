# MyCal — 日常工作台 · 项目规划

> 一个「日历 + 每日待办」的 Web 应用:看月历,点哪天,就管哪天的事。
> v0.3 起整体运行在 **Cloudflare Workers + D1** 上,表结构由 **迁移文件** 管理。

## 1. 项目目标

- **月历视图**:按月展示,翻上/下月,一键回到今天;
- **点击某天 → 当日详情**:待办 / 日程双 Tab 分离管理;
- **数据存 Cloudflare D1(SQLite)**:本地与线上同一套迁移,换设备不丢;
- **ICS 订阅导入**:粘贴日历订阅链接,日程按日期自动铺进日历;
- **轻量、快**:前端 + API 一体部署到 Workers,无独立服务器。

## 2. 功能范围

| 模块 | 功能点 |
| --- | --- |
| 日历 | 月视图网格(周一打头)、上/下月切换、回到今天 |
| 日历 | 「今天」高亮、选中日高亮、双圆点标记(蓝=日程,琥珀=待办,可并存) |
| 当日面板 | **待办 / 日程双 Tab 分离列表**(不混排)、完成度进度条、周数、空状态 |
| 待办 Tab | 添加(回车/按钮)、勾选完成/取消、删除;自定义复选框 |
| 日程 Tab | 时间轴样式(时刻 + 竖条)、全天归档显示、可移除单条日程 |
| ICS 导入 | **Ctrl+I 或顶栏「订阅」呼出弹窗** → 提交后弹窗立即关闭 → 后台导入 → Toast 提示结果 |
| ICS 去重 | 唯一索引 `(uid, date_key)` + `INSERT OR IGNORE`,重复导入零副作用 |
| 主题 | Tailwind v4 + daisyUI 5;自定义浅色主题 + dim 深色,顶栏按钮切换 |
| 布局 | 按 1920×1080 设计:双栏铺满全宽(超宽屏上限 1920),列表区独立滚动 |

### 已知边界(个人日常够用,列为 v2 增强)

- RRULE 重复规则**不展开**:跳过并在导入结果中计数提示;
- Workers 无本机时区,ICS 时间统一按 **UTC 墙钟**处理(与本机东八区显示存在换算差);
- 导入窗口为今天 ±365 天(UTC),单次最多 500 条,多日事件最多铺 30 天;
- 导入是手动触发,暂无定时自动同步。

## 3. 技术方案

- **前端**:Vite 8 + React 18 + TypeScript(严格模式),Tailwind CSS v4 + daisyUI 5;
- **后端**:Cloudflare **Worker**(`worker/index.ts`,自写轻路由),D1 绑定 `mycalDB`;
- **数据库**:**Cloudflare D1**;本地开发时 Vite 的 Cloudflare 插件在进程内跑 workerd + 本地 D1,`/api` 无需代理;
- **表结构管理**:`migrations/*.sql` 迁移文件(见下节),**不再使用代码内建表**;
- **ICS 解析**:`worker/ics.ts`(行折叠 / 全天 / UTC / TZID / 多日展开),纯标准 API,Workers 可用。

### 表结构管理(迁移体系)

```
migrations/
├── 0001_init.sql             # todos 表 + date/uid 索引
└── 0002_uid_date_unique.sql  # 去重唯一索引 (uid, date_key)
```

- **变更流程**:新建 `000N_描述.sql` → `pnpm db:migrate:local`(本地验证)→ 部署时 `deploy` 脚本自动先 `db:migrate:remote` 再 `wrangler deploy`;
- wrangler 记录已应用的迁移(`d1_migrations` 表),**只会执行未应用过的文件**,可安全重复;
- **构建(`pnpm run build`)不连接数据库**,结构漂移不会导致构建失败,而会在运行时暴露 —— 因此约定:**改表必须走迁移文件,禁止只改代码**。

### 数据模型

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
CREATE INDEX idx_todos_date      ON todos(date_key);
CREATE INDEX idx_todos_uid       ON todos(uid);
CREATE UNIQUE INDEX idx_todos_uid_date ON todos(uid, date_key); -- ICS 去重
```

### REST API(与 v0.2 完全兼容)

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/todos` | 全量:`{ "YYYY-MM-DD": Todo[] }` |
| POST | `/api/todos` | 添加:`{ dateKey, text }` → Todo |
| POST | `/api/todos/:id/toggle` | 切换完成态 → Todo |
| DELETE | `/api/todos/:id` | 删除 → `{ ok }` |
| POST | `/api/ics/import` | 导入:`{ url }` → `{ fetchedEvents, imported, duplicates, skippedRecurring, outOfWindow }` |

## 4. 目录结构

```
mycal/
├── PLAN.md / README.md
├── index.html / package.json / tsconfig.json / tsconfig.worker.json / vite.config.ts
├── wrangler.jsonc              # Workers + D1(migrations_dir) + SPA 静态资产
├── migrations/                 # ★ 表结构唯一事实源(按序应用)
│   ├── 0001_init.sql
│   └── 0002_uid_date_unique.sql
├── worker/                     # ★ API 后端(跑在 Cloudflare Workers)
│   ├── index.ts                # fetch 入口 + 路由
│   ├── db.ts                   # D1 查询(CRUD / 批量导入去重)
│   ├── ics.ts                  # ICS 解析/展开
│   ├── env.d.ts                # Env 绑定类型
│   └── types.ts                # Todo / TodoRow
├── src/                        # React 前端(不变)
│   ├── main.tsx / App.tsx / types.ts / utils/date.ts
│   ├── hooks/useTodos.ts
│   └── components/             # Calendar / DayCell / DayPanel / ImportModal / Toasts
└── docs/
    └── sample.ics              # ICS 导入本地测试样例
```

## 5. 交互设计

1. 打开应用 → 默认当月、选中今天,自动从后端加载数据;
2. 点任意日期 → 右侧面板切换为该天;
3. **待办与日程分 Tab 展示**:待办 Tab 勾选/添加/删除;日程 Tab 时间轴展示;
4. **Ctrl+I(或顶栏「订阅」)→ 弹窗粘贴 .ics 链接 → 导入** → 弹窗立即关闭,后台拉取解析,完成后 Toast 提示;
5. 日历圆点:蓝 = 有日程,琥珀 = 有待办,两种可同时出现;选中日圆点变白;
6. 顶栏月亮/太阳按钮切换深浅色主题(记忆在 localStorage)。

## 6. 启动与部署

```bash
pnpm install

# 开发:Vite 内嵌运行 worker + 本地 D1(miniflare)
pnpm db:migrate:local    # 首次/迁移变更后应用(本地)
pnpm run dev             # http://localhost:5173

# 部署:构建 → 远端迁移 → 发布(一条命令,顺序有保证)
pnpm run deploy

# 本地预览生产构建
pnpm run preview
```

数据库命令:

| 命令 | 说明 |
| --- | --- |
| `pnpm db:migrate:local` | 应用未执行的迁移到本地 D1 |
| `pnpm db:migrate:remote` | 应用到远端生产 D1(deploy 已内置) |
| `npx wrangler d1 migrations list mycal_db --remote` | 查看远端未应用的迁移(部署前体检) |

试试导入:把 `docs/sample.ics` 用任意静态服务暴露后粘贴链接(或直接用真实订阅 URL)。

## 7. 里程碑

1. ✅ v0.1:规划 → 日历+待办(localStorage 版)
2. ✅ v0.2:SQLite 持久化 + REST API;ICS 订阅导入;待办/日程双 Tab
3. ✅ v0.3:**迁移到 Cloudflare Workers + D1**:Express 退役,API 重写为 Worker;表结构改为迁移文件管理(含去重唯一索引);本地 dev 由 Cloudflare Vite 插件内嵌 workerd;deploy 前置远端迁移;清理原型页/草图生成器等历史产物
4. ⬜ v2 候选:订阅定时自动同步(Cron Triggers)、RRULE 展开、待办文字编辑、优先级、导出 JSON 备份
