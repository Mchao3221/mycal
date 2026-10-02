# MyDocs — 只读文档阅读器

左边目录树,右边阅读区。内容来自 Gitee 私有仓库 [`chu-tianshu/my-docs`](https://gitee.com/chu-tianshu/my-docs),**只读不改** —— 这个应用永远不写仓库、不提交、不改任何文件,写作仍然在 Obsidian 里做,这里只负责舒服地读。

> v0.5.0 由「私人 AI 健康日志 MyCal」整体重构而来,健康日志相关代码与数据表已全部退役。
> v0.6.2 起内容由本机 `pnpm run sync` 推送到 Cloudflare,阅读只读云端副本。

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

**先同步到 Cloudflare,之后只读云端副本。** 内容不是实时拉取的:`pnpm run sync` 把你本机的文档目录推送到 Cloudflare D1,阅读时只读这份副本,快且稳定,也完全不依赖任何外部服务。

**为什么同步要从本机发起(而不是让服务端去 Gitee 取)。** 三条网络路径都实测过,没有一条可靠:

| 取数方 | 结果 |
|---|---|
| Cloudflare Worker → gitee.com | **fetch 超时**(网络根本不通) |
| 浏览器 fetch → gitee.com | **403**(Gitee 的 WAF 拦浏览器) |
| 本机 Node 连续请求 → gitee.com | 前 150 个成功,**之后被风控限流成 403** |

而文档本来就在你自己的机器上:`git pull` 之后跑一次脚本就行 —— 不碰网络、不受限流,连令牌都不需要了。

**增量同步,而且是零写入的那种。** 每个文件按**内容自身的 git blob 哈希**寻址:没变就不写任何东西。实测第一次全量 789 个文件约 25 秒,之后再跑是「0 个需要上传」、秒级完成;本地删掉的文件也会在收尾时从云端一并清理。

**中文编码不会乱码。** 这个仓库里 2022 年前后的一批 SQL 是 GBK 编码的。同步是**字节忠实**的(原样入库),服务端探测出非 UTF-8 后如实声明 `charset=gb18030`,前端按声明的编码解码。这里有个坑值得记一笔:Fetch 规范的 `response.text()` **一律按 UTF-8 解码、完全无视响应头里的 charset**,所以读取端是自己读 `arrayBuffer()` 再用 `TextDecoder` 解码的。

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
| 数据库 | Cloudflare D1(SQLite):访问码锁 + **同步进来的文档副本**(按内容哈希寻址 + 512KB 分块) |
| Markdown | markdown-it 15 + highlight.js 11(按需注册语言)+ KaTeX + DOMPurify |
| 图形 | Mermaid 11(动态加载,约 1.4 MB,只在遇到图时才下载) |
| 其它渲染 | epubjs(EPUB,懒加载) |
| 字体 | Maple Mono NF CN 自托管 GB2312 子集(4 字重,约 6.7 MiB),显式钉死为全站字体 |

## 本地开发

```bash
pnpm install
pnpm db:migrate:local     # 建表(含文档存储用的三张表)

# 复制模板并填本地文档目录(不需要任何令牌)
copy .dev.vars.example .dev.vars
#   DOCS_DIR=C:\03Docs\my-docs

pnpm run dev              # http://localhost:5173
pnpm run sync             # 另开一个终端:把文档推上去(先 git pull)
```

首次打开会提示「仓库尚未同步」,跑一次 `pnpm run sync` 即可。

> Windows 上 `pnpm db:migrate:local` 若报 “Wrangler requires at least Node.js v22”,是 PATH 里的 Node 太老;用 Node 22+ 的目录前置 PATH 再执行(`pnpm run sync` 同样需要 Node 18+)。

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
