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
| 日历 | 「今天」高亮、选中日高亮、三圆点标记(蓝=日程,琥珀=待办,绿=打卡,可并存) |
| 当日面板 | **待办 / 打卡双分段 Tab**(不混排)、完成度进度条、周数、空状态 |
| 待办 Tab | 添加(回车/按钮)、勾选完成/取消、删除;自定义复选框 |
| 日程 | **选中日日程展示在月历下方**(时间轴样式:时刻 + 竖条、全天归档、可移除单条),不占 Tab |
| 打卡 Tab | 每日**饮食(早/午/晚/加餐)与运动**条目快记;热量可手动填或留空待 AI 估算;行内点击 kcal 可修正/清除 |
| 打卡 Tab | **AI 每日汇总**:估算缺失热量(不覆盖手动值)→ 算摄入/消耗/净差 → 结合档案点评;按天缓存可重生成 |
| 健康档案 | 性别/年龄/身高/体重/目标体重/活动量/目标方向,顶栏「档案」弹窗,仅存本库 |
| AI 设置 | OpenAI 兼容服务(Base URL + API Key + 模型),顶栏「AI」弹窗;密钥只写不读 |
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

-- 0003_health_diary.sql — 打卡日记 + 健康档案 + AI 汇总 + 应用设置
CREATE TABLE health_logs (
  id          TEXT PRIMARY KEY,
  date_key    TEXT NOT NULL,
  kind        TEXT NOT NULL,      -- 'diet'=摄入 | 'exercise'=消耗
  text        TEXT NOT NULL,      -- 「一碗牛肉面」
  meal        TEXT,               -- 仅 diet:breakfast/lunch/dinner/snack
  kcal        INTEGER,            -- 千卡;NULL=待 AI 估算
  kcal_source TEXT,               -- 'manual'(不被 AI 覆盖)| 'ai'
  created_at  INTEGER NOT NULL
);
CREATE TABLE profile (            -- 健康档案:全局单行(id=1)
  id INTEGER PRIMARY KEY CHECK (id = 1),
  sex TEXT, age INTEGER, height_cm REAL, weight_kg REAL,
  target_weight_kg REAL, activity TEXT, goal TEXT, updated_at INTEGER
);
CREATE TABLE ai_summaries (date_key TEXT PRIMARY KEY, content TEXT, created_at INTEGER);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); -- ai.baseUrl / ai.apiKey / ai.model
```

### AI 汇总策略(worker/ai.ts)

1. 前置校验:当天有打卡记录、档案四要素齐全、API Key 已配置,否则 400;
2. 配置优先级:`settings` 表 > 环境变量/secret(`AI_BASE_URL/AI_API_KEY/AI_MODEL`)> 默认(`https://api.openai.com/v1` / `gpt-4o-mini`);
3. 一次 `/chat/completions` 调用:为缺热量条目逐条估算(**只回填空值,不覆盖手动值**)+ 150 字内中文点评;回复按 JSON 解析(容忍 ``` 围栏);
4. 热量口径在服务端确定性计算:Mifflin-St Jeor BMR × 活动系数(不含刻意运动)= TDEE,总消耗 = TDEE + 运动打卡,净差按 7700 kcal ≈ 1 kg 折算;
5. 汇总按天落 `ai_summaries` 缓存,重新生成即覆盖;GET 接口永不回显 API Key。

### REST API(与 v0.2 完全兼容)

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/todos` | 全量:`{ "YYYY-MM-DD": Todo[] }` |
| POST | `/api/todos` | 添加:`{ dateKey, text }` → Todo |
| POST | `/api/todos/:id/toggle` | 切换完成态 → Todo |
| DELETE | `/api/todos/:id` | 删除 → `{ ok }` |
| POST | `/api/ics/import` | 导入:`{ url }` → `{ fetchedEvents, imported, duplicates, skippedRecurring, outOfWindow }` |
| GET | `/api/health` | 全量打卡:`{ "YYYY-MM-DD": HealthLog[] }` |
| POST | `/api/health` | 添加:`{ dateKey, kind, text, meal?, kcal? }` → HealthLog |
| PATCH | `/api/health/:id` | 改文字/餐次/热量(`kcal:null` = 恢复待估) |
| DELETE | `/api/health/:id` | 删除 → `{ ok }` |
| GET/PUT | `/api/profile` | 健康档案(未建返回 null;PUT 校验后整行 upsert) |
| GET/PUT | `/api/ai/config` | AI 服务配置 `{ baseUrl, model, hasKey }`;**GET 永不返回 key**,PUT 空串=清除 |
| GET | `/api/ai/summary/:dateKey` | 缓存的汇总(null = 未生成) |
| POST | `/api/ai/summary` | `{ dateKey }` → 调 AI 估算+点评并落库 → AiSummary |
| DELETE | `/api/ai/summary/:dateKey` | 清除当日汇总 → `{ ok }` |

## 4. 目录结构

```
mycal/
├── PLAN.md / README.md
├── index.html / package.json / tsconfig.json / tsconfig.worker.json / vite.config.ts
├── wrangler.jsonc              # Workers + D1(migrations_dir) + SPA 静态资产
├── migrations/                 # ★ 表结构唯一事实源(按序应用)
│   ├── 0001_init.sql
│   ├── 0002_uid_date_unique.sql
│   └── 0003_health_diary.sql   # 打卡/档案/AI 汇总/设置 4 张表
├── worker/                     # ★ API 后端(跑在 Cloudflare Workers)
│   ├── index.ts                # fetch 入口 + 路由(正则匹配,HttpError 统一转状态码)
│   ├── db.ts                   # D1 查询(待办/打卡/档案/汇总/设置)
│   ├── ai.ts                   # AI 每日汇总(OpenAI 兼容调用 + BMR/TDEE 估算)
│   ├── validate.ts             # dateKey/kcal/档案入参校验
│   ├── ics.ts                  # ICS 解析/展开
│   ├── env.d.ts                # Env 绑定类型(D1 + AI_* 兜底变量)
│   └── types.ts                # Todo / HealthLog / Profile / AiSummary …
├── src/                        # React 前端
│   ├── main.tsx / App.tsx / types.ts
│   ├── utils/date.ts  utils/api.ts        # 日期计算 / 共享 fetch 封装
│   ├── hooks/useTodos.ts  hooks/useHealth.ts
│   └── components/             # Calendar / DayCell / DayPanel / DiaryPanel /
│                               # ImportModal / ProfileModal / AiConfigModal / Toasts
└── docs/
    ├── sample.ics              # ICS 导入本地测试样例
    └── sql/                    # 需在 Cloudflare 网页 D1 Console 执行的脚本(由用户执行)
```

## 5. 交互设计

1. 打开应用 → 默认当月、选中今天,自动从后端加载数据;
2. 点任意日期 → 右侧面板切换为该天;
3. **待办 / 打卡分 Tab 展示**,日程不占 Tab:选中某天后,该天的 ICS 日程以时间轴显示在左侧月历下方(有则显示,无则隐藏);
4. **Ctrl+I(或顶栏「订阅」)→ 弹窗粘贴 .ics 链接 → 导入** → 弹窗立即关闭,后台拉取解析,完成后 Toast 提示;
5. **打卡日记**:切饮食/运动,记「一碗牛肉面」即可;热量可留空由 AI 估;点条目上的 kcal 可手动修正(AI 不再覆盖)或清空回「待估」;
6. **AI 汇总**:先顶栏「档案」填四要素 + 「AI」配好服务 → 点「生成今日汇总」→ AI 估热量并结合 BMR/TDEE 点评,结果按天缓存,可清除重生成;
7. 日历圆点:蓝 = 有日程,琥珀 = 有待办,绿 = 有打卡,可并存;选中日圆点变白;
8. 顶栏月亮/太阳按钮切换深浅色主题(记忆在 localStorage)。

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

**部署分工(用户约定)**:开发侧只把代码推到 GitHub,Cloudflare 经 GitHub 集成自动构建部署;**远程 D1 的一切改动**(应用迁移、数据修正)由用户在网页 D1 Console 执行,执行脚本存档于 `docs/sql/`。`pnpm run deploy` 仅由 Cloudflare CI 或用户本人使用。

## 7. 里程碑

1. ✅ v0.1:规划 → 日历+待办(localStorage 版)
2. ✅ v0.2:SQLite 持久化 + REST API;ICS 订阅导入;待办/日程双 Tab
3. ✅ v0.3:**迁移到 Cloudflare Workers + D1**:Express 退役,API 重写为 Worker;表结构改为迁移文件管理(含去重唯一索引);本地 dev 由 Cloudflare Vite 插件内嵌 workerd;deploy 前置远端迁移;清理原型页/草图生成器等历史产物
4. ✅ v0.3.1:**打卡日记 + AI 每日汇总**:饮食/运动条目、热量三态(手动/AI/待估)、健康档案(BMR/TDEE)、OpenAI 兼容汇总按天缓存;日历第三圆点(绿)
5. ⬜ v2 候选:订阅定时自动同步(Cron Triggers)、RRULE 展开、待办文字编辑、优先级、导出 JSON 备份;打卡体重曲线、AI 流式输出
