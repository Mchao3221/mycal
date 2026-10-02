# MyDocs — 只读文档阅读器 · 重构记录

> v0.5.0 由「私人 AI 健康日志 MyCal」原地重构而来。原产品的规划(迷你月历、一日一卡、AI 汇总、体重曲线等)随业务代码一并退役,不再保留。
> 本文只记录**这次重构做了什么决定、以及为什么**,方便后续接手时不重踩同一个坑。

## 1. 目标与边界

- **只读**:永远不写 Gitee 仓库、不提交、不改文件。后端只有 `GET /api/docs/tree` 与 `GET /api/docs/raw?path=` 两个业务接口,没有任何写方法。
- **数据源**:Gitee 私有仓库 `chu-tianshu/my-docs` 的 `master` 分支。写作仍在 Obsidian 里进行,本站只负责读。
- **布局**:左目录树 + 右阅读区,两栏各自内部滚动,整页不出滚动条(桌面一屏工作台)。
- **不做**:搜索(第一版明确不做,靠目录树自己找)、写入、多用户、移动端专门适配。

## 2. 保留了什么、删了什么

**保留(工程骨架,与业务无关)**

- Cloudflare Worker + 自写轻路由;D1 只留下 `settings` 与 `auth_sessions` 两张表服务访问码锁;
- 访问码锁整套机制(PBKDF2-SHA256、可撤销会话、7 天滑动续期、防爆破指数退避)—— 仓库本身是私有的,这层锁是第二道门;
- 双 tsconfig 的前后端隔离、Vite 内嵌 worker 的开发形态、GitHub → Cloudflare 的部署链路;
- Maple Mono NF CN 自托管字体子集与 daisyUI 主题体系。

**删除**

- `worker/ai.ts`、`worker/validate.ts`、`worker/types.ts`(`HttpError` 抽到新的 `worker/http.ts`,否则 `lock.ts` 会继续依赖已删的 `ai.ts`);
- 前端全部健康日志组件与 hooks(日历、打卡、流水、体重、AI 汇总面板等);
- 健康日志业务表:`health_logs` / `day_logs` / `weight_logs` / `ai_summaries` / `profile` / `todos`(迁移 `0006_docs_reader.sql`,远端脚本见 `docs/sql/远端重构_删除健康日志表.sql`)。

## 3. 关键技术决定(都是实测结论,不是推测)

### 3.1 为什么必须走 Worker 代理

- 仓库私有,匿名访问一律 **404**;
- raw 直链 `gitee.com/{repo}/raw/master/{path}?access_token=` 对私有仓库**即使带令牌也返回 403**;
- 且 raw 直链**不返回任何 CORS 头**,浏览器直连拿不到内容;
- 对照:Gitee 的 `api/v5/*` 返回 `Access-Control-Allow-Origin: *`。

结论:令牌只放 Worker 侧,浏览器永远不接触。

### 3.2 取数为什么按文件类型分流

两条可用接口的**语义不同**:

| 接口 | GBK 文件 | 二进制 | 缓存友好度 |
|---|---|---|---|
| `contents?ref=` | **自动规整成 UTF-8** | 原样透传 | 路径寻址 |
| `git/blobs/{sha}` | **返回原始 GBK 字节** | 原样透传 | 内容寻址(不可变) |

仓库里 2022 年前后的一批 SQL 确实是 GBK 的(逐字节比对确认:Gitee 的 `contents` 返回的正是「本地 GBK 按 GB18030 解码再存 UTF-8」的结果)。

结论:**文本走 `contents`(要转码,否则中文乱码),二进制走 `git/blobs`(要字节精确)**,`raw` 只作公开仓库兜底 —— 放首位等于每次读文件白白撞一次 403。

### 3.3 其他踩过的坑

- Gitee 对**不存在的分支返回 200 + 空树**(不是 404),必须显式判空,否则分支名写错会静默显示一棵空目录树;
- 树接口返回的顶层 `sha` **只是回显传入的 ref 名**(传 `master` 就回 `"master"`),不能当版本号;`rev` 取自分支接口的 commit sha;
- 文档路由用**查询串 `?doc=`** 而不是 hash:Markdown 的标题锚点天生占用 hash,hash 路由会和锚点互相冲掉;
- `@cloudflare/vite-plugin` 会在 `worker/` 下创建 `.xxx.tmpdir/` 临时目录,监听它在 Windows 上撞 `EBUSY` 直接打挂 dev 进程,必须加 `server.watch.ignored`;
- `pnpm-workspace.yaml` 的 `allowBuilds` 留占位字符串会让 `pnpm install` 退出码 1,进而让 `pnpm run dev` 的依赖预检失败。

## 4. 验证情况

- **文件树**:与本地仓库按同一隐藏规则逐路径比对,**789/789 完全一致,零差异**;
- **文件内容**:按格式抽样做 SHA-256 比对 —— UTF-8 的 md/sql 与仓库字节一致;GBK 的老 SQL 正确规整为 UTF-8;epub(2.4MB)/pptx(461KB)/xlsx 二进制字节精确一致;
- **访问码锁**:未登录访问 tree/raw 均 401;连输 5 次错码后进入冷却,冷却期内即使密码正确也返回 429;解锁后可正常取数;「上锁」后旧 cookie 立即失效(401);
- `pnpm run build` 的两个 tsc 与 vite build 均通过。

## 5. 后续可以做的事(按需,不急)

- 全文搜索:内容已经在 D1 里了,可以给 `doc_files` 加 FTS5 影子表,同步时顺带写索引;
- 自动同步:现在是手动点刷新。可以加 Cloudflare Cron Triggers 定时跑同一套 `plan → files → finish`;
- 图片/附件的懒加载与预览优化;
- Mermaid 图目前是整图自适应 + 点击全屏(可拖拽缩放),如果想在图内做搜索/定位可以再补;
- 若恢复对 `.excalidraw` 的画布支持,注意官方包本身 1 MB+ 且自带一套 mermaid 传递依赖,
  务必保持懒加载(当时的实现见 git 历史里的 `src/components/ExcalidrawView.tsx`)。

## 6. v0.6.x:为什么内容同步必须从本机发起

**原设计**:Worker 代理 Gitee,每次打开文件都实时取。

**问题**:这把「Cloudflare 到 Gitee 的链路质量」直接变成了每次打开文件的体验。链路一慢,整站就慢;
失败时的回退链(contents → branches → trees → blobs → raw)最多要打 5 个上游请求,一次卡顿被放大成五次。

**第一版改造(v0.6.0)**:点刷新,由 Worker 把仓库同步进 D1,之后只读副本。
架构方向是对的,但线上一点同步就报 `fetch=超时 20000ms` —— **Cloudflare 到 gitee.com 根本不通**。
换服务端容器也一样,这是网络可达性问题,不是代码问题。

**第二版(v0.6.1)**:改由浏览器取数再上传给 Worker。
结果 **Gitee 的 WAF 对浏览器直接返回 403**(换正常 UA、指定代理都一样),
而同一时刻 curl / Node 请求同一个 URL 却是 200。

**第三版(v0.6.2,当前)**:连 Node 直连也不可靠 —— 连续请求 789 个文件时,
**前 150 个成功,之后被风控限流成 403**。

**结论**:取数这件事不该走网络。文档本来就在本机,`git pull` + `pnpm run sync` 把目录推上去即可:
不碰网络、不受限流、连令牌都不需要。三条网络路径的实测记录保留在 CLAUDE.md 里,
以后若有人想"顺手从远端拉一下",先看那张表。

**保留的设计**(换了取数方,这些依然成立):
- **存储用 D1**:本来就有绑定,免费额度对 789 个文件 / 约 9MB 内容绰绰有余。
  实测占用 8.65MB、770 个内容块。R2 更适合大文件与流式读取,但为此多引一个服务与一套绑定不划算;
  KV 的每日写入额度(1000)反而会被一次全量同步顶到边。
- **按内容哈希寻址 + 512KB 分块**:内容没变就零写入(第二次同步是「0 个需要上传」、秒级完成),
  「中断后重来」天然是续传;分块是因为 D1 单行有大小上限,2.4MB 的 epub 不分块塞不进去。
- **上传用原始字节放 body**:省 33% 体积,Worker 侧零解码。
- **上传接口要求已解锁**:沿用访问码锁,不额外发明一套同步密钥。

**另一个值得记住的坑**:Fetch 规范的 `response.text()` **一律按 UTF-8 解码、无视响应头的 charset**。
这个仓库里 GBK 的 SQL 起初在页面上是乱码,而字节流与 `charset=gb18030` 响应头全都正确 ——
读取端改成自己读 `arrayBuffer()` 再用 `TextDecoder` 解码才对。
