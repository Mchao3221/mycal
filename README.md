# MyCal — 私人 AI 健康日志

一个「日历导航 + 每日日志 + AI 汇总」的私有 Web 应用:点哪天,看哪天、记哪天;吃动、流水、体重一张卡,晚上让 AI 帮你看一天。

- 🔒 **访问码锁**:打开先过全屏锁屏,校验全在服务端(PBKDF2 + 可撤销会话);记住 7 天,顶栏「上锁」一键踢掉所有设备,忘记密码可到 D1 手动重置;
- 📅 **迷你月历导航**:日历缩为左栏导航器(数字+圆点),只负责看哪天有东西、切日期;
- 📝 **当日流水**:记录"今天做了哪些事"(事后视角,不是待办),多条时间序、行内改删,AI 汇总一起消化;
- 🍽 **吃动打卡 + AI 每日汇总**:饮食/运动条目热量可留空,AI(OpenAI 兼容)补齐并结合档案 BMR/TDEE 与当日流水、体重给出收支点评;
- ⚖️ **体重曲线 + BMI**:一天一条晨起空腹,7 日均平滑曲线 + 目标线,BMI 按中国标准分段,按近期节奏估算达标周数;
- 📥 **ICS 订阅导入**:`Ctrl+I` 粘贴订阅链接,日程按日期铺进日历(仅作展示),重复导入零副作用;
- ☁️ **Cloudflare Workers + D1**:前端与 API 一体部署,数据存 D1(SQLite),表结构由迁移文件管理;
- 🌗 **深浅色主题**:Tailwind v4 + daisyUI 5,一键切换(记忆在 localStorage)。

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
# 打开 http://localhost:5173 —— 首次会进入"设置访问码"流程,之后每次都要先解锁
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

**部署分工约定**:日常开发只需把代码推到 GitHub,Cloudflare 经仓库集成自动构建部署;涉及远程 D1 的 SQL(迁移应用、数据修正)写在 `docs/sql/`,由维护者在 Cloudflare 网页 D1 Console 执行。

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
| GET | `/api/lock/status` | `{ isSet, unlocked }`(唯一免鉴权的读接口) |
| POST | `/api/lock/setup` · `/unlock` · `/lock` | 设置访问码(仅一次)/ 解锁 / 立即上锁(清空所有会话) |
| GET | `/api/todos` | 日程全量:`{ "YYYY-MM-DD": Todo[] }`(v0.4 起仅 ICS 日程) |
| DELETE | `/api/todos/:id` | 移除单条日程 → `{ ok }` |
| POST | `/api/ics/import` | 导入:`{ url }` → `{ fetchedEvents, imported, duplicates, skippedRecurring, outOfWindow }` |
| GET | `/api/journal` | 流水全量:`Record<date, JournalEntry[]>` |
| POST/PATCH/DELETE | `/api/journal` · `/api/journal/:id` | 流水增(≤500 字)改删 |
| GET | `/api/health` | 打卡全量:`Record<date, HealthLog[]>` |
| POST/PATCH/DELETE | `/api/health` · `/api/health/:id` | 打卡条目 CRUD |
| GET/POST/DELETE | `/api/weights` · `/api/weights/:dateKey` | 体重:全量 / 按日期 upsert / 删除 |
| GET/PUT | `/api/profile` | 健康档案;`GET` 的当前体重由最新体重记录推导 |
| GET/PUT | `/api/ai/config` | AI 服务配置 `{ baseUrl, model, hasKey }`(密钥只写不读) |
| GET/POST/DELETE | `/api/ai/summary/:dateKey` · `/api/ai/summary` | AI 每日汇总:读取 / 生成 / 清除 |

> 🔒 除 `lock/status|setup|unlock` 外,所有 `/api/*` 都要求有效会话 Cookie,否则 401;连续输错访问码 5 次起进入指数退避冷却。

## 每日日志与 AI 汇总

1. 首次打开设置**访问码**(全屏锁),之后 7 天内免输,顶栏可随时「上锁」踢掉所有设备;
2. 顶栏「档案」填性别/年龄/身高/目标(当前体重以体重记录为准),「AI」配置任一 OpenAI 兼容服务的 Base URL + API Key + 模型;
3. 右栏自上而下记一天:**当日流水**(做了哪些事)→ **今日体重**(晨起空腹,一天一条)→ **饮食/运动条目**(热量可留空);
4. 点「生成今日汇总」→ AI 逐条估算缺失热量(不覆盖手动值),结合 BMR/TDEE、当日流水与体重(含近 7 日均值)给出摄入/消耗/净差与点评;结果按天缓存,可清除重生成;
5. 左栏「体重走势」点开曲线:7 日均主线 + 目标线 + BMI(中国标准分段)+ 按近期节奏估算达标周数,支持任意日期补录。

密钥可存 `settings` 表(经 UI),也可用环境变量兜底:`AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`(生产建议 `wrangler secret put AI_API_KEY`)。忘记访问码:在 D1 Console 执行 [`docs/sql/解锁码重置.sql`](docs/sql/解锁码重置.sql)。

## 项目结构

```
mycal/
├── index.html / vite.config.ts / tsconfig.json / tsconfig.worker.json
├── wrangler.jsonc                # Workers + D1 绑定 + 迁移目录 + SPA 静态资产
├── migrations/                   # ★ 表结构唯一事实源
│   ├── 0001_init.sql             # todos 表 + 索引
│   ├── 0002_uid_date_unique.sql  # ICS 去重唯一索引
│   ├── 0003_health_diary.sql     # 打卡 / 档案 / AI 汇总 / 设置 4 张表
│   └── 0004_journal_lock_weight.sql  # 流水 / 体重 / 会话 + 清退手动待办
├── worker/                       # ★ API 后端(跑在 Cloudflare Workers)
│   ├── index.ts                  # fetch 入口 + 路由 + 鉴权门(未解锁一律 401)
│   ├── lock.ts                   # 访问码 PBKDF2 校验 / 可撤销会话 / 防爆破冷却
│   ├── db.ts                     # D1 查询(日程/流水/打卡/体重/档案/汇总/设置/会话)
│   ├── ai.ts                     # AI 每日汇总(OpenAI 兼容 + BMR/TDEE 估算)
│   ├── validate.ts               # dateKey/kcal/体重/档案入参校验
│   ├── ics.ts                    # ICS 解析/展开
│   ├── env.d.ts                  # Env 绑定类型(D1 + AI_* 变量)
│   └── types.ts                  # Todo / JournalEntry / HealthLog / WeightEntry / Profile …
├── src/                          # React 前端
│   ├── main.tsx / App.tsx(锁门控 + 工作台)/ types.ts
│   ├── utils/date.ts / utils/api.ts / utils/stats.ts
│   ├── hooks/useEvents.ts · useHealth.ts · useJournal.ts · useWeights.ts
│   └── components/               # LockScreen / Calendar / DayCell / DayView /
│                                 # JournalPanel / DiaryPanel / WeightToday /
│                                 # WeightSparkline / WeightModal / ImportModal /
│                                 # ProfileModal / AiConfigModal / Toasts
└── docs/
    ├── sample.ics                # ICS 导入本地测试样例
    └── sql/                      # 需在 Cloudflare 网页 D1 Console 执行的脚本
```

## 路线图

- ✅ v0.1:规划 → 日历 + 待办(localStorage 版)
- ✅ v0.2:SQLite 持久化 + REST API;ICS 订阅导入;待办/日程双 Tab;Tailwind + daisyUI 重构
- ✅ v0.3:迁移到 Cloudflare Workers + D1;表结构改为迁移文件管理;deploy 前置远端迁移;清理原型页与草图生成器
- ✅ v0.3.1:打卡日记(饮食/运动 + 热量)+ 健康档案 + AI 每日汇总(OpenAI 兼容);日历第三圆点(绿)
- ✅ v0.4:**定位转型「私人 AI 健康日志」**:访问码锁(服务端校验/可撤销会话/防爆破);迷你月历侧栏 + 当日日志主体;待办退役为**当日流水**(day_logs);体重记录 + 7 日均曲线 + BMI(中国标准)+ 达标预估;AI 汇总扩料(流水 + 有效体重)
- ⬜ 下一轮候选:ICS **时区修正**(按 VTIMEZONE/TZID 换算,消除 UTC 墙钟差一天)、自然语言快记拆条、AI 周报/月报、数据导出 JSON 备份、AI 流式输出;~~RRULE 展开 / 订阅定时同步~~(降级:日程仅需可见,手动 Ctrl+I 足够)

更完整的规划与交互设计见 [`PLAN.md`](PLAN.md)。
