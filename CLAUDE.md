# CLAUDE.md

本文件为在此仓库工作的 AI 提供指引。

## 项目概述

MyDocs —「只读文档阅读器」(v0.7.0)。左侧目录树 + 右侧阅读区,**只读不改**。

**它是一个纯本地应用**:`pnpm run dev` 起一个开发服务器,**由它直接读你本机磁盘上的文档目录**。
没有云端、没有上传、没有同步、没有访问码、没有数据库。

支持 Markdown(Obsidian 方言、KaTeX、Mermaid)、SQL/TXT 只读高亮、图片、EPUB 在线读,
其余二进制新窗口打开。文档均为中文,提交信息也用中文。

> **为什么是本地而不是部署到 Cloudflare**(2026-09 的决定,别再绕着走的弯路):
> 部署在 Cloudflare 的网页跑在 Cloudflare 的机器上,**永远读不到用户本机的磁盘**;
> 要线上能读就必须先把内容上传。而上传说到底要去 Gitee 取数,三条路实测全不可用:
> Worker→gitee 超时、浏览器→gitee 被 WAF 拦成 403、本机连续请求被风控限流。
> 既然只需要在本机读,就根本不需要取数 —— 直接读文件。详见 PLAN.md 第 6 节。

## 常用命令

```bash
pnpm install            # 包管理器是 pnpm v11(packageManager 字段固定),不要用 npm
pnpm run dev            # 开发:http://localhost:13627
pnpm run build          # tsc --noEmit(只查 src/)→ vite build
pnpm run preview        # 构建后本地预览生产形态(同一个文档服务也会挂上)
```

- **无测试框架**;`pnpm run build` 里的 `tsc --noEmit` 是唯一的静态检查手段。
- `vite.config.ts` 与 `tools/*.mjs` **不在 tsc 检查范围内**(`tsconfig.json` 只 include `src`)。
  改它们只能靠跑起来验证,所以务必真的启动一次 dev 再提交。
- 需要 Node 18+(Vite 8 要求更高;本机 nvm 里若只有 Node 14,先 `nvm use 22`)。

## 配置

配置只有两个环境变量,放在项目根目录的 `.env`(已被 `.gitignore` 忽略;模板见 `.env.example`):

```
DOCS_DIR=C:\03Docs\my-docs     # 要阅读的文档目录(绝对路径)
PORT=13627                     # 开发服务器端口(可选,默认就是 13627)
```

不设置时用默认值(`vite.config.ts` 里用 `loadEnv(mode, cwd, '')` 读进来)。
改了文件**不用重启**,点顶栏「重新加载」即可重新扫描。

**端口为什么是 13627**:刻意避开 3000 / 5173 / 8080 这些热门开发端口,免得以后和别的工具撞。
`server.strictPort` 与 `preview.strictPort` 都是 `true`:**端口被占时直接报错退出,不会悄悄挪到下一个端口** ——
悄悄换端口会让书签和你记着的地址失效,那是比"端口被占"更难察觉的一种冲突。

## 架构要点

- **本地文档服务 `tools/docs-server.mjs`(整个后端就这一个文件)**:一个 Vite 插件,
  在 `configureServer` / `configurePreviewServer` 上挂中间件,提供两个接口:
  - `GET /api/docs/tree` → 递归扫描 `DOCS_DIR`,返回 `{ dir, rev, totalBytes, files[] }`。
    每项的版本号是 **`大小-修改时间`** 而不是内容哈希:列一次目录不该把 9MB 全读一遍,
    `stat` 就够;文件一改 mtime 就变,前端拿到的 URL 也就变了。实测列全树 **97ms**。
  - `GET /api/docs/raw?path=` → 读文件。文本先读出来判一次编码再声明 charset,二进制流式下发。
  - **越界防护在这个文件里,改它时别弄丢**:拒绝空段 / `.` / `..` / 反斜杠 / NUL / 以 `.` 开头的段,
    并要求解析结果落在 `DOCS_DIR` 之内。实测 `../../`、绝对路径、反斜杠、隐藏项 5 种尝试全部 400。
  - 为什么不用 Worker:workerd 跑在沙箱里读不到宿主机任意文件;而且既然后端就一个文件,
    写成 `.mjs` 还省掉了为开发期插件引入 `@types/node`。
- **前端数据流**:`App.tsx` 直接渲染 `Workspace`(没有锁屏状态机了)。
  `useDocs.ts` 提供 `useDocsTree`(拉清单)与 `useDocContent`(拉正文)。
- **取文本必须自己解码,不能用 `res.text()`**:Fetch 规范的 `text()` **一律按 UTF-8 解码、
  完全无视响应头里的 charset**。这个仓库里 2022 年前后的 SQL 是 GBK 的,服务端已经如实声明
  `charset=gb18030`,但 `text()` 照样解成乱码(实测:字节流与响应头都对,页面却是乱码)。
  `src/utils/api.ts` 的 `fetchText` 自己读 `arrayBuffer()` 再按声明的 charset 用 `TextDecoder` 解码。
- **路由用查询串而不是 hash**:当前文档是 `?doc=<uri 编码后的仓库路径>`,见 `src/hooks/useDocRoute.ts`。
  原因是 Markdown 标题锚点天生占用 hash(这个仓库的 README 自己就有 `[一、设计理念](#一设计理念)`),
  hash 路由会和锚点互相冲掉。跳转用 `pushState` + 一份模块级订阅名单(pushState 不派发 popstate)。
- **阅读区分发**:`src/components/ReaderPane.tsx` 按 `kindOf(path)` 分发到
  MarkdownView / CodeView / ImageView / EpubView / ExternalView,并用 ResizeObserver 量出可用宽高
  给 epub 这类需要确定尺寸的渲染器。epubjs 是懒加载的。
- **EPUB(`src/components/EpubView.tsx`)有一个必须记住的调用约定**:
  **绝对不要写 `ePub(url)`,必须自己 `fetch` 出 `arrayBuffer` 再 `ePub(bytes)`**。
  epub.js 用 `path.parse(url).extension` 判断输入类型,而我们的接口 URL 是
  `/api/docs/raw?path=…epub&sha=…`,它解析出的扩展名是 `epub&sha=…` ——
  既不等于 `"epub"` 也不等于 `"binary"`,`open()` 落进谁都不匹配的分支,
  `book.ready` 永远不 resolve,界面永远停在「正在加载电子书… 0%」。
  传 ArrayBuffer 时它按 binary 处理,完全不碰 URL 解析。**这个 bug 长期存在**,
  因为此前只验证过 epub 的**字节**正确,从没验证过它**能不能被打开**(修好后实测 503ms 打开)。
  教训:字节级验证不能替代"这个功能在真机里能用"的验证。
- **Markdown 管线在 `src/utils/markdown.ts`**:markdown-it + GFM 任务列表 + KaTeX
  (`$...$` 与 `$$...$$`)+ Obsidian 方言(wikilink / 嵌入 / callout / frontmatter / `==高亮==`)
  + 资源路径重写 + **DOMPurify 消毒**。对外只暴露 `renderMarkdown(source, { docPath, knownPaths })`。
  **允许内嵌 HTML**,所以消毒是必需的,改这里时不要把 DOMPurify 摘掉。
- **Mermaid 图(`src/utils/mermaid.ts`)**:```mermaid 代码块先由 `markdown.ts` 产出
  `<div class="mermaid-block"><pre class="mermaid-source">源码</pre></div>` 占位,
  再由 MarkdownView 在内容挂载后调用 `hydrateMermaidBlocks` 换成 SVG。
  - mermaid 本体及图表类型是**动态 import**,合计约 1.4 MB 独立 chunk,不打开带图的文档一个字节都不下载;
  - 源码始终留在 `.mermaid-source` 里:渲染失败时它就是可读的退化内容,切主题重渲染也不必回到原文再解析;
  - `securityLevel: 'strict'`,单块失败要隔离。
  - **尺寸策略**:全部逻辑在纯函数 `computeFitScale` 里(可脱离 DOM 单测)。优先级:
    **① 横向永不溢出** → ② 尽量整屏显示 → ③ 最后才守可读下限 `MIN_SCALE = 0.55`;小图不放大。
  - **交互**:点击正文里的图 → 全屏查看器 `MermaidLightbox.tsx`(拖拽平移、滚轮缩放锚定光标、
    点击/ESC 关闭)。注意:滚轮**必须手动 `addEventListener('wheel', fn, { passive: false })`**
    (React 的 `onWheel` 是被动监听,里面 `preventDefault()` 无效);**点击与拖拽要区分**
    (位移 <4px 才算点击,否则一拖就关);克隆进全屏的 SVG 带着正文里缩小过的 `width/height`,
    **必须按 viewBox 重置为自然尺寸**;打开期间锁 `document.body.style.overflow`。
- **代码高亮只有一个实例**:`src/utils/highlight.ts` 用 `highlight.js/lib/core` 按需注册十几种语言
  (不要改成 `import hljs from 'highlight.js'`,那会把 190 多种语言全打进包)。
  **颜色不在 JS 里**,由 `src/styles.css` 按 `[data-theme]` 手写 `.hljs-*` 规则。
- **目录树全部折叠启动**:783 个文件,一进页面全展开既卡又难找;打开深层文件时会自动展开其祖先目录。
  不做虚拟滚动 —— 折叠状态下 DOM 里只有顶层几个节点。
  注意这个仓库的形状:`02_项目/脚本` 约 230 个子目录、其下 `History` 又有约 200 个,
  所以展开到深层文件后侧栏会有 250 行上下(约 11 屏)。**这是数据的客观形状,不是 bug。**
  曾经为了这个把顶层做成 sticky 常驻(commit 9151307),后来回滚了 —— 当时用户看到的
  "只剩两个文件夹"实际是**数据不完整**造成的,与呈现方式无关。**要动这棵树之前,先确认问题真在呈现层。**
- **归档类文件不展示**(`tools/docs-server.mjs` 的 `IGNORED_EXT`,目前只有 `zip`):
  阅读器不解压也不提供下载,列在目录里只会干扰浏览。
- **本地偏好一律 localStorage**(`src/utils/storage.ts`,统一 `mydocs:` 前缀):目录展开状态、栏宽、主题。

## 其他约定

- UI 文案、注释、错误消息均为中文,新增代码保持一致。
- 主题切换用 daisyUI 的 `data-theme`(`mycal` 浅色 / `dim` 深色),记忆在 localStorage
  (键 `mydocs:theme`,与 `index.html` 里的首帧脚本必须一致)。
- **字体**:全站 Maple Mono NF CN,而且**必须是显式声明,不能靠间接传递**。
  `src/styles.css` 里做了四件事,缺一个都会静默退回系统字体(Windows 中文 = 微软雅黑):
  1. 四条 `@font-face`(400/500/600/700)先 `local()` 后 `url("/fonts/*.woff2")`;
     `public/fonts/` 里是提交进仓库的 GB2312 子集(4 字重约 6.7 MiB),用 `python tools/subset_fonts.py` 重新生成。
  2. `@theme` 里显式写 `--default-font-family: var(--font-sans)`,不依赖 Tailwind 默认主题的间接赋值。
  3. `@layer base` 里直接 `html { font-family: var(--font-sans) }`,并让
     `button/input/select/textarea` 显式继承 —— 表单控件默认用浏览器自己的 UI 字体,是"字体不对"最常见的来源。
  4. `index.html` 里 `<link rel="preload" as="font" crossorigin>` 预加载 400 字重;
     `crossorigin` 不能省,漏了预加载会被丢弃并变成两次下载。
  回退栈里不要放 `system-ui` / `"Segoe UI"`:那会让英文在 webfont 未就绪时变成 proportional。
  等宽字体要排在中文回退字体之前。
- **桌面端是一屏工作台**:`lg` 及以上根容器 `h-dvh + overflow-hidden`,顶栏固定、左右两栏各自内部滚动
  (`.panel-scroll`)。**窄屏未专门适配**(用户明确表示不需要)。
- **`vite.config.ts` 的 `server.watch.ignored` 不要删**:写文件的工具会先在同目录建
  `.<名字>.<pid>.<uuid>.tmpdir/`,监听它在 Windows 上会撞 `EBUSY`(resource busy or locked)
  并**直接打挂 dev 进程**。这个坑已经踩过两次(先前是 `@cloudflare/vite-plugin` 的 `worker/.xxx.tmpdir/`)。
- `pnpm-workspace.yaml` 的 `allowBuilds` 必须给每个有安装脚本的依赖明确的 `true`/`false`。
  **留占位字符串(或让 pnpm 自己写进去的 `set this to true or false`)会让 `pnpm install` 退出码 1。**
