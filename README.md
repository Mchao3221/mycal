# MyDocs — 只读文档阅读器

左边目录树,右边阅读区。内容实时来自 Gitee 私有仓库 [`chu-tianshu/my-docs`](https://gitee.com/chu-tianshu/my-docs),**只读不改** —— 这个应用永远不写仓库、不提交、不改任何文件,写作仍然在 Obsidian 里做,这里只负责舒服地读。

> v0.5.0 由「私人 AI 健康日志 MyCal」整体重构而来,健康日志相关代码与数据表已全部退役。

## 能读什么

| 格式 | 打开方式 |
|---|---|
| `.md` | 完整渲染:GFM + 表格 + 任务列表 + 代码高亮 + **KaTeX 公式** + **Mermaid 图形** + Obsidian 方言(`[[wikilink]]` 内部跳转、`![[嵌入]]`、`> [!note]` callout、frontmatter、`==高亮==`) |
| `.sql` `.txt` `.json` 等文本 | 只读高亮 + 行号(这个仓库有 752 个 SQL,是绝对主力) |
| `.png` `.jpg` `.gif` `.webp` `.svg` | 直接显示,可切换「适应宽度 / 原始尺寸」 |
| `.epub` | 在线阅读(翻页、书内目录、字号、跟随主题) |
| `.pptx` `.xlsx` `.zip` 等 | 新窗口打开,预览还是下载交给浏览器 |

## 几个关键设计

**只读,而且是真只读。** 阅读侧只有两个接口:`GET /api/docs/tree`(文件清单)和 `GET /api/docs/raw?path=`(单个文件)。没有编辑、没有删除、没有任何回写仓库的路径。

**先把仓库同步进 Cloudflare,之后只读本地副本。** 早期版本是每次打开文件都实时代理 Gitee,结果把「Cloudflare 到 Gitee 的链路质量」直接变成了阅读体验 —— 链路一慢,整站都慢。现在点右上角「刷新」触发一次同步(把仓库搬进 D1),之后打开文件完全不碰 Gitee,快且稳定。

**增量同步,而且是零写入的那种。** 内容按 git blob 的 sha **内容寻址**存储:内容没变就不写任何东西。实测 789 个文件里只有 766 个唯一 sha(有 23 个文件内容完全相同,自动去重),而同步过一次之后再点刷新是「入库 0 个文件」。中断了重来也是续传。

**令牌不下发到浏览器。** 仓库是私有的,匿名访问一律 404,必须带 Gitee 访问令牌。令牌只存在 Worker 侧(本地 `.dev.vars` / 生产 `wrangler secret`),同步时由 Worker 去取内容,浏览器从头到尾接触不到它。而且**读路径完全不需要令牌** —— 同步过一次之后,哪怕令牌失效,已经同步的内容照样能读。

**中文编码不会乱码。** 这个仓库里 2022 年前后的一批 SQL 是 GBK 编码的。Gitee 的 `contents` 接口会顺手把它们规整成 UTF-8,而 `git/blobs` 返回的是原始字节 —— 所以取数按文件类型分流:**文本走 `contents`(要转码),二进制走 `git/blobs`(要字节精确)**。这条差异是拿仓库里的真实文件逐字节比对出来的。

**Mermaid 图点击即全屏。** 正文里的图按「横向永不溢出 → 尽量整屏显示 → 最后才守可读下限」自适应;点一下打开全屏查看器,可拖拽平移、滚轮缩放(锚定光标),点击或 ESC 关闭。mermaid 本体约 1.4 MB,只在真的遇到图时才按需下载。

**字体是显式钉死的等宽字体。** 全站 Maple Mono NF CN,并且不依赖任何框架的间接传递:`@theme` 显式设 `--default-font-family`、`@layer base` 直接给 `html` 定字体、表单控件强制继承(浏览器默认会给它们另一套 UI 字体,是"字体看起来不对"最常见的原因)、`index.html` 预加载 400 字重以缩短 `font-display: swap` 期间显示系统字体的窗口。


**访问码锁。** 打开先过全屏锁屏,校验全在服务端(PBKDF2-SHA256 + 可撤销会话),`/api/docs/*` 未解锁一律 401;记住 7 天,顶栏「上锁」一键让所有设备的旧 cookie 立刻失效。忘记访问码可到 Cloudflare D1 手动重置。

**路由用查询串而不是 hash。** 当前文档是 `?doc=<编码后的仓库路径>`,这样 Markdown 里的标题锚点(比如本仓库 README 自己的 `[一、设计理念](#一设计理念)` 目录)才能正常工作;hash 路由会和锚点互相冲掉。

**本地偏好只存 localStorage**(目录展开状态、栏宽、深浅色),不会同步到其它设备 —— 这个应用刻意不为此引入数据库。

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Vite 8 + React 18 + TypeScript(严格模式) |
| 样式 | Tailwind CSS v4 + daisyUI 5(浅色 `mycal` / 深色 `dim`) |
| 后端 | Cloudflare Worker(`worker/`,自写轻路由、无框架) |
| 数据库 | Cloudflare D1(SQLite):访问码锁 + **同步进来的仓库副本**(按 sha 内容寻址 + 512KB 分块) |
| Markdown | markdown-it 15 + highlight.js 11(按需注册语言)+ KaTeX + DOMPurify |
| 图形 | Mermaid 11(动态加载,约 1.4 MB,只在遇到图时才下载) |
| 其它渲染 | epubjs(EPUB,懒加载) |
| 字体 | Maple Mono NF CN 自托管 GB2312 子集(4 字重,约 6.7 MiB),显式钉死为全站字体 |

## 本地开发

```bash
pnpm install
pnpm db:migrate:local     # 建 settings / auth_sessions 两张表

# 复制模板并填入自己的 Gitee 私人令牌(只读权限即可)
copy .dev.vars.example .dev.vars
#   ⚠️ 令牌只能填在 .dev.vars;.dev.vars.example 是要提交进 Git 的模板

pnpm run dev              # http://localhost:5173
```

令牌生成入口:<https://gitee.com/profile/personal_access_tokens>,权限勾「projects / 仓库代码」只读。

> Windows 上 `pnpm db:migrate:local` 若报 “Wrangler requires at least Node.js v22”,是 PATH 里的 Node 太老;用 Node 22+ 的目录前置 PATH 再执行。

## 部署

推送 GitHub 后由 Cloudflare 的 GitHub 集成自动构建部署。生产环境的令牌用 `wrangler secret put GITEE_TOKEN` 单独配置,不进仓库。

## 目录结构

```
worker/
  index.ts      路由入口:锁 + 两个文档接口
  docs.ts       Gitee 取数层(文件树、按类型分流的三级回退、路径校验)
  lock.ts       访问码锁(PBKDF2、可撤销会话、防爆破)
  db.ts         D1 访问(settings / auth_sessions)
  http.ts       HttpError 与 JSON 响应工具
src/
  App.tsx       锁屏门 + 工作台外壳
  components/   DocTree 目录树、ReaderPane 分发、各格式视图
  hooks/        useDocs(数据)、useDocRoute(路由)、useSidebarWidth(栏宽)
  utils/        markdown 渲染、highlight 高亮、tree 建树、fileKind 分类、storage、api
migrations/     D1 表结构唯一事实源
docs/sql/       需要手动在 Cloudflare Console 执行的脚本
```
