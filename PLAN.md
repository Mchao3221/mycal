# MyCal — 私人 AI 健康日志 · 项目规划

> 一个「日历导航 + 每日日志 + AI 汇总」的私有 Web 应用:点哪天,看哪天、记哪天。
> v0.3 起整体运行在 **Cloudflare Workers + D1** 上,表结构由 **迁移文件** 管理;v0.4 起有**访问码锁**。

## 1. 项目目标

- **迷你月历导航**:日历只负责"看哪天有记录 + 切日期",缩在左栏,不再占据主角;
- **一日一张卡**:流水(做了啥)/ 吃动打卡 / 体重 / AI 汇总在同一面板纵向铺开;
- **数据存 Cloudflare D1(SQLite)**:本地与线上同一套迁移,换设备不丢;
- **私有**:全站先过访问码锁,校验在服务端,可一键踢掉所有设备;
- **轻量、快**:前端 + API 一体部署到 Workers,无独立服务器。

> v0.4.1 起**日程功能整体退役**(ICS 订阅导入、`todos` 表、`worker/ics.ts` 全部移除),应用聚焦"每日健康日志 + AI 汇总"。

## 2. 功能范围

| 模块 | 功能点 |
| --- | --- |
| 锁 | 全屏锁屏(未解锁不渲染任何数据);首次打开设置访问码;PBKDF2 服务端校验 |
| 锁 | 会话 7 天(不足 3 天滑动续期),最多 5 台设备;顶栏「上锁」清空全部会话真撤销 |
| 锁 | 防爆破:连续失败 ≥5 次指数退避冷却(封顶 5 分钟);重置需 D1 手动删键 |
| 日历 | **迷你月历导航器**(周一打头,数字+绿点,一行一格)+ 上/下月切换 + 回到今天 |
| 日历 | 圆点标记:绿 = 当天有记录(打卡/流水/体重任一) |
| 左栏 | 本月概况(记录天数 / 条数 / 🔥连续记录)+ 体重走势卡(sparkline,点开曲线) |
| 当日 | **当日流水**:"今天做了哪些事"多条时间序,行内编辑/删除,≤500 字 |
| 当日 | **今日体重**:一行式录入,一天一条同日覆盖,显示较 7 日均偏离 |
| 当日 | **吃动打卡**:饮食(早/午/晚/加餐)与运动条目快记;热量手动填或留空待 AI 估 |
| 当日 | **AI 每日汇总**:估缺省热量(不覆盖手动)+ 结合流水/体重/BMR/TDEE 点评;按天缓存可重生成 |
| 体重 | 曲线弹窗:7 日均主线 + 原始点 + 目标线;90 天/1 年/全部;BMI 中国标准分段;按近期节奏估算达标周数;任意日期补录/删除 |
| 健康档案 | 性别/年龄/身高/目标体重/活动量/目标方向;**当前体重以体重记录为单一事实源**(档案接口推导回填) |
| AI 设置 | OpenAI 兼容服务(Base URL + API Key + 模型),顶栏弹窗;密钥只写不读 |
| 主题 | Tailwind v4 + daisyUI 5;浅色 mycal + 深色 dim,顶栏切换(localStorage 记忆) |
| 布局 | 桌面端一屏工作台:左栏 240px 导航/概览,右栏日志主体,各自内部滚动 |

### 已知边界

- **日程与 ICS 订阅已整体退役**(v0.4.1):`todos` 表 DROP、`worker/ics.ts` 删除、日历蓝点移除;不再依赖 worker 侧 UTC 时区;
- **待办早已退役**(v0.4):应用聚焦"事后记录"的健康日志,无事前任务清单;
- 访问码强度≈数据安全性,防"偶然窥探"不防定向攻击;忘记只能 D1 手动重置;
- 其他设备触发「上锁」时,当前已打开页面会开始报 401,刷新回锁屏即可。

## 3. 技术方案

- **前端**:Vite 8 + React 18 + TypeScript(严格模式),Tailwind CSS v4 + daisyUI 5;
- **后端**:Cloudflare **Worker**(`worker/index.ts`,自写轻路由),D1 绑定 `mycalDB`;
- **锁**:`worker/lock.ts`,纯 WebCrypto(PBKDF2 派生 + SHA-256 会话哈希),无第三方 auth 依赖;
- **数据库**:**Cloudflare D1**;本地开发时 Vite 的 Cloudflare 插件在进程内跑 workerd + 本地 D1,`/api` 无需代理;
- **表结构管理**:`migrations/*.sql` 迁移文件(见下节),**不再使用代码内建表**;
- **体重图表**:`WeightModal` / `WeightSparkline` 手写 SVG(7 日均滑 + 原始点 + 目标线),不引图表库。

### 表结构管理(迁移体系)

```
migrations/
├── 0001_init.sql                  # todos 表(v0.4.1 起 0005 已 DROP,弃用)
├── 0002_uid_date_unique.sql       # ICS 去重索引(历史)
├── 0003_health_diary.sql          # 打卡 / 档案 / AI 汇总 / 设置
├── 0004_journal_lock_weight.sql   # 流水 / 体重 / 会话 + 清退手动待办
└── 0005_drop_schedule.sql         # 日程功能退役,DROP todos
```

- **变更流程**:新建 `000N_描述.sql` → `pnpm db:migrate:local`(本地验证)→ 部署时 `deploy` 脚本自动先 `db:migrate:remote` 再 `wrangler deploy`;
- wrangler 记录已应用的迁移(`d1_migrations` 表),**只会执行未应用过的文件**,可安全重复;
- **构建(`pnpm run build`)不连接数据库**,结构漂移不会导致构建失败,而会在运行时暴露 —— 因此约定:**改表必须走迁移文件,禁止只改代码**。

### 数据模型

```sql
-- v0.4.1:todos 表已被 0005 DROP(手动待办与 ICS 日程双双退役),以下即当前全部结构

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
CREATE TABLE profile (            -- 健康档案:全局单行(id=1);weight_kg 仅作无体重记录时回退
  id INTEGER PRIMARY KEY CHECK (id = 1),
  sex TEXT, age INTEGER, height_cm REAL, weight_kg REAL,
  target_weight_kg REAL, activity TEXT, goal TEXT, updated_at INTEGER
);
CREATE TABLE ai_summaries (date_key TEXT PRIMARY KEY, content TEXT, created_at INTEGER);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
--   ai.baseUrl / ai.apiKey / ai.model
--   lock.salt / lock.hash / lock.fails(v0.4,访问码与防爆破)

-- 0004_journal_lock_weight.sql — v0.4 新增
CREATE TABLE day_logs (           -- 当日流水:"今天做了哪些事"
  id TEXT PRIMARY KEY, date_key TEXT NOT NULL,
  text TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE weight_logs (        -- 体重:一天一条,同日 upsert(晨起空腹)
  date_key TEXT PRIMARY KEY, weight_kg REAL NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE auth_sessions (      -- 会话:只存 token 的 SHA-256,「上锁」= 清空本表
  token_hash TEXT PRIMARY KEY, label TEXT,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
```

### 访问码锁设计(worker/lock.ts)

1. 访问码 → `PBKDF2-SHA256(10 万迭代——workerd 硬上限,勿调高;随机 16B salt)` 存 `settings`;明文不落库不落日志;未设置前接口放行(bootstrap),`setup` 仅可调一次;
2. 解锁成功签发 256bit 随机 token,库中只存其 SHA-256;`Set-Cookie: mycal_session=…; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`(https 下才加 `Secure`);
3. 会话 7 天,打开应用时剩余不足 3 天滑动续期;最多 5 台设备并存,超出淘汰最旧;「上锁」清空全表 → 旧 cookie 即刻作废(无状态签名 token 做不到,这是选有状态的原因);
4. 防爆破:`settings.lock.fails` 记连续失败,≥5 次起指数退避冷却(15s×2^n,封顶 5 分钟),429 返回中文剩余秒数;
5. 鉴权门在 `fetch` 入口:除 `lock/status|setup|unlock` 外的所有 `/api/*` 先验会话,无效 401;
6. 重置:D1 删 `settings` 中 `lock.*` 三行 + 清 `auth_sessions`(见 `docs/sql/解锁码重置.sql`)。

### AI 汇总策略(worker/ai.ts)

1. 前置校验:当天有打卡**或**流水、档案齐全(体重取最新 `weight_logs`,回退 `profile.weight_kg`)、API Key 已配置,否则 400;
2. 配置优先级:`settings` 表 > 环境变量/secret(`AI_BASE_URL/AI_API_KEY/AI_MODEL`)> 默认(`https://api.openai.com/v1` / `gpt-4o-mini`);
3. 一次 `/chat/completions` 调用:为缺热量条目逐条估算(**只回填空值,不覆盖手动值**)+ 150 字内中文点评(会结合**当日流水与体重**,给久坐打断/饮食节奏类建议);回复按 JSON 解析(容忍 ``` 围栏);
4. 热量口径在服务端确定性计算:Mifflin-St Jeor BMR × 活动系数(不含刻意运动)= TDEE,总消耗 = TDEE + 运动打卡,净差按 7700 kcal ≈ 1 kg 折算;
5. 汇总按天落 `ai_summaries` 缓存(含 `weightKg`),重新生成即覆盖;GET 接口永不回显 API Key。

### REST API(v0.4;🔒 标记外全部要求有效会话)

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | 🔒免`/api/lock/status` | `{ isSet, unlocked }` |
| POST | 🔒免`/api/lock/setup` · `/unlock` | 设置访问码(仅首次)/ 解锁;失败计数与冷却在此 |
| POST | `/api/lock/lock` | 立即上锁:清空所有会话 + 过期 cookie |
| GET | `/api/journal` | 流水全量:`Record<date, JournalEntry[]>` |
| POST | `/api/journal` | 添加:`{ dateKey, text }`(≤500 字)→ JournalEntry |
| PATCH/DELETE | `/api/journal/:id` | 改文字 / 删除 |
| GET | `/api/health` | 全量打卡:`Record<date, HealthLog[]>` |
| POST | `/api/health` | 添加:`{ dateKey, kind, text, meal?, kcal? }` → HealthLog |
| PATCH | `/api/health/:id` | 改文字/餐次/热量(`kcal:null` = 恢复待估) |
| DELETE | `/api/health/:id` | 删除 → `{ ok }` |
| GET | `/api/weights` | 全量体重:`Record<date, WeightEntry>` |
| POST | `/api/weights` | `{ dateKey, weightKg }`(20~400,保留 0.1)按日 upsert |
| DELETE | `/api/weights/:dateKey` | 删除某天体重 → `{ ok }` |
| GET/PUT | `/api/profile` | 档案;GET 的 `weightKg` 由最新体重记录推导回填 |
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
│   ├── 0003_health_diary.sql   # 打卡/档案/AI 汇总/设置 4 张表
│   ├── 0004_journal_lock_weight.sql  # 流水/体重/会话 + 清退手动待办
│   └── 0005_drop_schedule.sql  # 日程退役,DROP todos(ics.ts 一并删除)
├── worker/                     # ★ API 后端(跑在 Cloudflare Workers)
│   ├── index.ts                # fetch 入口 + 鉴权门 + 路由(正则匹配,HttpError 统一转状态码)
│   ├── lock.ts                 # 访问码:PBKDF2 / 可撤销会话 / 防爆破冷却
│   ├── db.ts                   # D1 查询(流水/打卡/体重/档案/汇总/设置/会话)
│   ├── ai.ts                   # AI 每日汇总(OpenAI 兼容调用 + BMR/TDEE 估算)
│   ├── validate.ts             # dateKey/kcal/体重/档案入参校验
│   ├── env.d.ts                # Env 绑定类型(D1 + AI_* 兜底变量)
│   └── types.ts                # JournalEntry / HealthLog / WeightEntry / Profile / AiSummary
├── src/                        # React 前端
│   ├── main.tsx / App.tsx(锁门控 + 工作台)/ types.ts
│   ├── utils/date.ts  utils/api.ts  utils/stats.ts   # 日期 / fetch / 均线·BMI·连续记录
│   ├── hooks/useHealth.ts · useJournal.ts · useWeights.ts
│   └── components/             # LockScreen / Calendar / DayCell / DayView / JournalPanel /
│                               # DiaryPanel / WeightToday / WeightSparkline / WeightModal /
│                               # ProfileModal / AiConfigModal / Toasts
└── docs/
    └── sql/                    # 需在 Cloudflare 网页 D1 Console 执行的脚本(由用户执行)
```

## 5. 交互设计

1. **打开应用 → 全屏锁屏**(未设置过则是"设置访问码"页);解锁后才挂载工作台、拉取数据,未解锁时前端不渲染任何数据界面;
2. 解锁进入 → 默认当月、选中今天;左栏迷你月历点任意日期 → 右栏日志主体即切换到该天;
3. **右栏一天一张卡,自上而下**:日期标题 → 当日流水(输入框回车即记,行内 ✎ 改 ✕ 删)→ 今日体重(同日覆盖,显示较 7 日均)→ 吃动打卡 + AI 汇总;
4. **左栏下方两块**:本月概况(记录天数 / 条数 / 🔥连续,跟随所看月份)、体重走势卡(sparkline + 最新值,点击开曲线弹窗:90 天/1 年/全部切换、补录/删除、BMI 中国标准、达标周数估算);
5. **打卡日记**:切饮食/运动,记「一碗牛肉面」即可;热量可留空由 AI 估;点条目上的 kcal 可手动修正(AI 不再覆盖)或清空回「待估」;
6. **AI 汇总**:先「档案」+「AI」配好 → 点「生成今日汇总」→ AI 估热量,并结合当日流水与体重给点评;当天没有任何吃动但有流水也能生成;结果按天缓存,可清除重生成;
7. 顶栏「🔒 上锁」:清空所有设备会话(含本机),回到锁屏——借电脑后的救命按钮;
8. 日历圆点:绿 = 当天有记录(打卡/流水/体重任一);选中日圆点变白;
9. 顶栏月亮/太阳按钮切换深浅色主题(记忆在 localStorage)。

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

**部署分工(用户约定)**:开发侧只把代码推到 GitHub,Cloudflare 经 GitHub 集成自动构建部署;**远程 D1 的一切改动**(应用迁移、数据修正)由用户在网页 D1 Console 执行,执行脚本存档于 `docs/sql/`。`pnpm run deploy` 仅由 Cloudflare CI 或用户本人使用。

## 7. 里程碑

1. ✅ v0.1:规划 → 日历+待办(localStorage 版)
2. ✅ v0.2:SQLite 持久化 + REST API;ICS 订阅导入;待办/日程双 Tab
3. ✅ v0.3:**迁移到 Cloudflare Workers + D1**:Express 退役,API 重写为 Worker;表结构改为迁移文件管理(含去重唯一索引);本地 dev 由 Cloudflare Vite 插件内嵌 workerd;deploy 前置远端迁移;清理原型页/草图生成器等历史产物
4. ✅ v0.3.1:**打卡日记 + AI 每日汇总**:饮食/运动条目、热量三态(手动/AI/待估)、健康档案(BMR/TDEE)、OpenAI 兼容汇总按天缓存;日历第三圆点(绿)
5. ✅ v0.4:**定位转型「私人 AI 健康日志」**:访问码锁(服务端 PBKDF2 / 可撤销会话 / 防爆破 / 一键上锁);布局重构(迷你月历侧栏 + 当日日志主体,解决信息密度);待办退役 → **当日流水**(day_logs,旧数据清空);体重记录 + 7 日均曲线 + BMI(中国标准)+ 达标预估,体重成为档案/AI 的单一事实源;AI 汇总扩料(流水 + 有效体重)
6. ✅ v0.4.1:**日程功能整体退役**:删除 ICS 订阅导入 / `worker/ics.ts` / `todos` 表 / 日历蓝点 / 右栏日程卡;不再依赖 worker 侧 UTC 时区,同时消除切换日期时的布局跳动
7. ⬜ 下一轮候选:自然语言快记拆条、AI 周报/月报、导出 JSON 备份、AI 流式输出
8. 🚫 明确不做(除非需求变化):多用户/账号体系、待办系统
