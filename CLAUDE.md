# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

MyDocs —「只读文档阅读器」Web 应用(v0.5.0 由「私人 AI 健康日志 MyCal」整体重构而来,健康日志业务已全部退役)。左侧目录树 + 右侧阅读区,**只读不改**,内容来自 Gitee 私有仓库 `chu-tianshu/my-docs`。

前端 Vite 8 + React 18 + TS(严格模式)+ Tailwind v4 + daisyUI 5;后端为 Cloudflare Worker(`worker/`,自写轻路由、无框架),D1 存访问码锁与**同步进来的仓库副本**。支持 Markdown(含 Obsidian 方言、KaTeX 公式与 Mermaid 图形)、SQL/TXT 只读高亮、图片、EPUB 在线读,其余二进制新窗口打开。文档均为中文,提交信息也用中文。

> v0.6.0 起**阅读路径不再实时访问 Gitee**:点「刷新」把仓库同步进 D1,之后只读本地副本。

> 仓库名与 Cloudflare 项目名仍叫 `mycal`(部署链路不动),只有界面品牌名与本文档改成了 MyDocs。

## 常用命令

```bash
pnpm install            # 包管理器是 pnpm v11(packageManager 字段固定),不要用 npm
pnpm run dev            # 开发:http://localhost:5173,Vite 内嵌运行 worker,/api 同源无需代理
pnpm db:migrate:local   # 应用迁移到本地 D1(miniflare,数据在 .wrangler/state)
pnpm run build          # 先 tsc --noEmit 检查两个 tsconfig,再 vite build(不连接数据库)
pnpm run preview        # 构建后用 wrangler dev 本地预览生产形态
pnpm run deploy         # build → 远端 D1 迁移 → wrangler deploy(顺序有保证,勿拆开手动执行)
```

无测试框架;`pnpm run build` 里的双 `tsc --noEmit` 是唯一的静态检查手段。

> Windows 本地开发注意:wrangler 会通过 PATH 找 `node`,系统里若装了老版本 Node,`pnpm db:migrate:local` 会报 "Wrangler requires at least Node.js v22"。用 Node 22+ 的目录前置 PATH 再执行即可。

## 环境变量与令牌(Gitee)

**只有同步流程需要令牌**;阅读走的是同步进 D1 的副本,令牌失效也不影响已同步内容的阅读。

- 本地:项目根目录 `.dev.vars`(已被 `.gitignore` 忽略),键名 `GITEE_TOKEN` / `GITEE_OWNER` / `GITEE_REPO` / `GITEE_BRANCH` / `GITEE_TIMEOUT_MS`;模板见 `.dev.vars.example`。
  **令牌只能填在 `.dev.vars`,千万别填进 `.dev.vars.example`** —— 那个文件是要提交进 Git 的。
- 生产:`wrangler secret put GITEE_TOKEN`(由用户执行)。
- 令牌只在 Worker 侧使用,任何响应体、任何前端代码里都不能出现它。

## 部署分工(用户约定,必须遵守)

- **AI 只负责代码**:编写/修改代码 → 保证 `pnpm run build`(两个 tsconfig 的 tsc)无编译错误 → 提交并推送 GitHub;Cloudflare 由 GitHub 集成自动 CI/CD 完成构建部署。
- **不要自行执行任何远程 Cloudflare 操作**:`wrangler deploy`、`wrangler login`、`wrangler d1 migrations apply --remote`、`wrangler d1 execute --remote` 等一律禁止。
- 需要改动远程数据库时(新增迁移、数据修正):**直接写出 SQL 脚本**(存档到 `docs/sql/描述.sql` 并贴在回复里),由用户在 Cloudflare 网页 D1 Console 亲自执行。
- 本地 D1(`.wrangler/state`,miniflare)不受限:`pnpm db:migrate:local`、`wrangler d1 execute --local` 与本地 workerd 验证照常进行。

## 架构要点

- **两套 tsconfig、两个运行环境**:`tsconfig.json` 编译 `src/`(浏览器 + DOM),`tsconfig.worker.json` 编译 `worker/`(Cloudflare Workers 类型)。前后端不共享代码;`Env` 类型在 `worker/env.d.ts`。
- **Worker 无框架路由**:`worker/index.ts` 的 `fetch` 入口用相等匹配 + method 处理 `/api/*`,未匹配返回 404,非 `/api/` 请求落到 SPA 静态资产回退(`wrangler.jsonc` 的 `not_found_handling`)。改 API 时保持这个模式。
- **Gitee 访问层 `worker/gitee.ts`**(只被同步流程使用,结论都是实测出来的):
  - **阅读路径不再实时回源**,改成先把仓库同步进 D1,之后只读本地副本 —— 见下面的「同步架构」。
  - **raw 直链对私有仓库无效**:`gitee.com/{repo}/raw/master/{path}?access_token=` 一律 403,且它还不返回任何 CORS 头。所以只把它当公开仓库的兜底,不能放首选(放首位等于每次访问都白白撞一次 403)。
  - **两条可用路径的语义不同,必须按文件类型分流**:
    - `contents?ref=` 会把 **GBK 等旧编码自动规整成 UTF-8** —— 这个仓库里大量 2022 年的 SQL 就是 GBK,所以**文本类型走它**(否则中文乱码);
    - `git/blobs/{sha}` 返回**原始字节**,内容寻址 —— **二进制类型(图片/epub/pptx/xlsx/zip)走它**,保证字节精确。
  - 失败时把上游状态码与响应片段一起报出来(`diagText`),便于区分「令牌无效」「路径写错」「被风控」。
  - **路径不存在时 Gitee 返回 200 + `[]`**;必须显式识别数组响应,否则会误报成"令牌有问题"。
  - **空文件的 `content` 是空字符串**,是合法内容。判断取数成功要用 `!== null` 而不是真值判断。
  - **文件树也要显式判空**:Gitee 对不存在的分支返回 **200 + 空树**(不是 404)。
  - 树接口返回的顶层 `sha` **只是回显传入的 ref 名**(传 master 就回 "master"),不能当版本号;rev 取分支接口的 commit sha。
  - 树里的文件按「任一路径段以 `.` 开头」过滤:挡掉 `.obsidian/`、`.tmp_*`、`.gitignore`。
  - 上游请求超时默认 20s,可用 `GITEE_TIMEOUT_MS` 覆盖;出现「连不上」类错误会立即收手,不再依次试后面的回退(否则一次卡顿会被放大成五次)。
- **同步架构(v0.6.0,本次最重要的架构决定)**:
  - **为什么改**:实时回源把「Cloudflare 到 Gitee 的链路质量」直接变成了每次打开文件的体验,链路一慢整站就慢,而且回退链在失败时最多要打 5 个上游请求。同步是一次性批量操作,慢可以接受;读路径必须快且稳定。
  - **存储用 D1 而不是 R2/KV**:项目本来就绑定了 D1,不需要额外开通服务;免费额度(5GB 存储、10 万行写入/天)对 789 个文件、约 9MB 内容绰绰有余(实测占用 8.65MB、770 个内容块)。R2 更适合大文件与流式读取,但为此多引入一个服务与一套绑定不划算;KV 的每日写入额度(1000)反而会被一次全量同步顶到边。
  - 三张表(`migrations/0007_doc_store.sql`):`doc_files`(清单:路径 → blob sha)、`doc_blobs`(**按 sha 内容寻址 + 512KB 分块**)、`doc_meta`(同步元信息)。
  - **内容寻址是这套设计的关键**:按 sha 判断是否需要写入,所以重复同步同一个文件**零写入** —— 实测全量 789 个文件里 766 个唯一 sha(去重了 23 个内容相同的文件),之后再点刷新是「入库 0 个文件」。既不浪费 D1 写入配额,也让「中断了再点一次」天然就是续传。
  - **分块是必须的**:D1 单行有大小上限,最大的文件是 2.4MB 的 epub,不分块塞不进去(实测切成 5 块)。
  - **流程拆成 plan → files(多批)→ finish**,由前端驱动循环(`src/hooks/useSync.ts`)。原因:一个 Worker 请求的时间与 CPU 都有上限,789 个文件一次做完会超;拆开后能显示进度,而且每一步都无状态,中断了重新点刷新即可续传。
  - **令牌仍然只留在 Worker 侧**:前端只传 `{path, sha}`,内容由 Worker 去 Gitee 取 —— 不让浏览器接触令牌。
  - **读路径完全不需要令牌**(`worker/docs.ts` 用 `repoInfo` 而不是 `confOf`):只要同步过一次,哪怕令牌失效/被移除,已同步的内容照样能读。
  - **空文件必须显式写一块空内容**:只留下清单行的话读回时会被判成「不存在」。这个 0 字节的 `000一定要按顺序执行.txt` 已经坑过两次(另一次是 `content: ""` 的真值判断),改这块务必回归它。
- **Worker 路由(`worker/index.ts`)**:`/api/lock/*`(锁)、`/api/docs/tree|raw`(只读本地副本)、`/api/sync/status|plan|files|finish`(同步)。全部 /api/* 除锁自身外都要先验会话。
- **访问码锁(`worker/lock.ts`)**:`fetch` 入口对除 `/api/lock/status|setup|unlock` 外的所有 `/api/*` 验会话,无效一律 401。密码 PBKDF2-SHA256(10 万迭代,workerd 拒绝 >100000,勿调高)存 `settings` 的 `lock.salt/lock.hash`;解锁签发随机 token,`auth_sessions` 只存其 SHA-256(所以"上锁"删表即可真撤销所有设备);HttpOnly cookie `mycal_session`,7 天滑动续期、上限 5 会话;失败计数 ≥5 次指数退避 429。忘记访问码:D1 删 `lock.*` 三行(见 `docs/sql/解锁码重置.sql`)。`HttpError` 等 HTTP 工具在 `worker/http.ts`(历史上从 `ai.ts` 借用,`ai.ts` 已删)。
- **表结构唯一事实源是 `migrations/*.sql`**:代码里没有任何建表语句。v0.5.0 的 `0006_docs_reader.sql` 把健康日志相关表全部 DROP,只留 `settings` 与 `auth_sessions`。改表必须新增增量迁移(不重写历史),`pnpm db:migrate:local` 本地验证;build 不连库,结构漂移只在运行时暴露。
- **前端数据流**:`App.tsx` 先查 `/api/lock/status` 决定渲染锁屏还是工作台(checking/setup/locked/ready 四态,文档 hooks 都在解锁后的 `Workspace` 里才挂载)。`useDocs.ts` 提供 `useDocsTree`(拉本地清单)与 `useDocContent`(只对文本类拉正文,用 `res.text()` 以便按后端声明的 charset 正确解码);`useSync.ts` 驱动整轮同步(plan → 分批 files → finish),并把进度、失败项、报错暴露给头部状态区。清单为空且 `syncedAt === 0` 时,`App` 直接渲染「仓库尚未同步」的引导页而不是空目录树。
- **路由用查询串而不是 hash**:当前文档是 `?doc=<uri 编码后的仓库路径>`,见 `src/hooks/useDocRoute.ts`。原因是 Markdown 里的标题锚点天生占用 hash(这个仓库的 README 自己就有 `[一、设计理念](#一设计理念)`),hash 路由会和锚点互相冲掉。跳转用 `pushState` + 一份模块级订阅名单(pushState 不派发 popstate),浏览器前进后退靠 popstate。
- **阅读区分发**:`src/components/ReaderPane.tsx` 按 `kindOf(path)` 分发到 MarkdownView / CodeView / ImageView / EpubView / ExternalView,并用 ResizeObserver 量出可用宽高给 epub 这类需要确定尺寸的渲染器。epubjs 是懒加载的(见下)。
- **Mermaid 图(`src/utils/mermaid.ts`)**:Markdown 里的 ```` ```mermaid ```` 代码块由 `markdown.ts` 产出 `<div class="mermaid-block"><pre class="mermaid-source">源码</pre></div>` 占位,再由 MarkdownView 在内容挂载后调用 `hydrateMermaidBlocks` 把它换成 SVG。要点:
  - mermaid 本身及图表类型是**动态 import**,合计约 1.4 MB 独立 chunk,不打开带图的文档就一个字节都不下载;
  - 源码始终留在 `.mermaid-source` 里:渲染失败时它就是可读的退化内容,切换主题重渲染时也不必回到 Markdown 原文再解析;
  - `securityLevel: 'strict'`,并且单块失败要隔离,一张图有问题不能让整篇的图都渲染不出来;
  - **尺寸策略**:全部逻辑在纯函数 `computeFitScale` 里(可脱离 DOM 单测)。优先级:**① 横向永不溢出**(阅读是纵向的,横向滚动条最难受)→ ② 尽量整屏显示(宽高同时约束)→ ③ 最后才守可读下限 `MIN_SCALE = 0.55`,高度实在放不下时允许纵向滚动但字号不再缩;小图不放大。改这些常量前先用纯函数跑一遍各尺寸场景。
  - **交互**:点击正文里的图 → 打开全屏查看器 `src/components/MermaidLightbox.tsx`(拖拽平移、滚轮缩放锚定光标、点击/ESC 关闭)。几个必须记住的点:
    - 滚轮**必须手动 `addEventListener('wheel', fn, { passive: false })`** —— React 的 `onWheel` 是被动监听,里面 `preventDefault()` 无效,页面会跟着滚;
    - **点击与拖拽必须区分**:按下到松开位移小于 4px 才算点击(否则一拖就关);
    - 克隆进全屏的 SVG 带着正文里被缩小过的 `width/height`,**必须按 viewBox 重置为自然尺寸**,否则全屏看到的是"放大的缩略图";
    - 打开期间锁 `document.body.style.overflow`,关闭时还原。
- **Markdown 管线在 `src/utils/markdown.ts`**:markdown-it + GFM 任务列表 + KaTeX(`$...$` 与 `$$...$$`)+ Obsidian 方言(wikilink / 嵌入 / callout / frontmatter / `==高亮==`)+ 资源路径重写 + **DOMPurify 消毒**。对外只暴露 `renderMarkdown(source, { docPath, knownPaths })`。**允许内嵌 HTML**,所以消毒是必需的,改这里时不要把 DOMPurify 摘掉。
- **代码高亮只有一个实例**:`src/utils/highlight.ts` 用 `highlight.js/lib/core` 按需注册十几种语言(不要改成 `import hljs from 'highlight.js'`,那会把 190 多种语言全打进包,约 1MB)。Markdown 渲染与源码视图共用 `highlightBlock`。**颜色不在 JS 里**,由 `src/styles.css` 按 `[data-theme]` 手写 `.hljs-*` 规则(所以也不能 import hljs 的主题 CSS)。
- **本地偏好一律 localStorage**(`src/utils/storage.ts`,统一 `mydocs:` 前缀):目录展开状态、栏宽、主题。项目已决定不为阅读进度引入 D1,所以这些不同步到其它设备。(早期版本还存过"最近阅读",该功能已按用户要求去掉;旧数据留在 `mydocs:recent` 里不影响任何逻辑。)
- **目录树全部折叠启动**:仓库有 789 个文件,一进页面全展开既卡又难找。打开深层文件时会自动展开其祖先目录。不做虚拟滚动 —— 折叠状态下 DOM 里只有顶层几个节点。

## 其他约定

- UI 文案、注释、错误消息均为中文,新增代码保持一致。
- 主题切换用 daisyUI 的 `data-theme`(`mycal` 浅色 / `dim` 深色),记忆在 localStorage(键 `mydocs:theme`,与 `index.html` 里的首帧脚本必须一致)。
- **字体**:全站 Maple Mono NF CN,而且**必须是显式声明,不能靠间接传递**。`src/styles.css` 里做了四件事,缺一个都会静默退回系统字体(Windows 中文 = 微软雅黑):
  1. 四条 `@font-face`(400/500/600/700)先 `local()` 后 `url("/fonts/*.woff2")` —— 装了完整字体的设备一个字节都不下载;`public/fonts/` 里是提交进仓库的 GB2312 子集(6763 汉字 + 拉丁/标点,4 字重共约 6.7 MiB),用 `python tools/subset_fonts.py` 重新生成;GB2312 之外的生僻字回退系统中文字体。
  2. `@theme` 里显式写 `--default-font-family: var(--font-sans)`,不依赖 Tailwind 默认主题的间接赋值。
  3. `@layer base` 里直接 `html { font-family: var(--font-sans) }`,并让 `button/input/select/textarea` 显式继承 —— 表单控件默认用浏览器自己的 UI 字体,不继承页面字体,是"字体不对"最常见的来源。
  4. `index.html` 里 `<link rel="preload" as="font" crossorigin>` 预加载 400 字重:字体 1.7 MiB,`font-display: swap` 期间首屏会先用系统字体渲染,不预加载就会看到"先雅黑、后切换"。`crossorigin` 不能省,漏了预加载会被丢弃并变成两次下载。
  回退栈里不要放 `system-ui` / `"Segoe UI"`:那会让英文在 webfont 未就绪时变成 proportional,和全站等宽的观感对不上。等宽字体要排在中文回退字体之前。
- **桌面端是一屏工作台**:`lg` 及以上根容器 `h-dvh + overflow-hidden`,顶栏固定、左右两栏各自内部滚动(`.panel-scroll`);去掉这套高度约束就会重新出现整页滚动条。**窄屏未专门适配**(用户明确表示不需要)。
- **Vite 配置里的 watcher 忽略项不要删**:`@cloudflare/vite-plugin` 会在 `worker/` 下创建 `.xxx.tmpdir/` 临时构建目录,监听它在 Windows 上会撞 `EBUSY` 并直接打挂 dev 进程,`vite.config.ts` 的 `server.watch.ignored` 就是为此存在的。
- `pnpm-workspace.yaml` 的 `allowBuilds` 必须给每个有安装脚本的依赖明确的 `true`/`false`。留占位字符串会让 `pnpm install` 退出码 1,进而让 `pnpm run dev` 的依赖预检直接失败。
