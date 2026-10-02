# MyDocs — 本地只读文档阅读器

左边目录树,右边阅读区。**只读不改** —— 这个应用永远不写你的文档、不提交、不改任何文件,写作仍然在 Obsidian 里做,这里只负责舒服地读。

## 怎么跑

```bash
pnpm install

# 复制模板,填上你的文档目录(不填默认就是 C:\03Docs\my-docs)
copy .env.example .env

pnpm run dev            # 打开 http://localhost:13627
```

就这三步。没有数据库、没有云端、没有访问码、没有同步。

> 需要 Node 18+(Vite 8 要求更高)。若本机 nvm 里只有老版本,先 `nvm use 22`。

**改了文档不用重启**:编辑/新增/删除文件之后,点顶栏的「重新加载」重新扫描一次即可。

## 能读什么

| 格式 | 打开方式 |
|---|---|
| `.md` | 完整渲染:GFM + 表格 + 任务列表 + 代码高亮 + **KaTeX 公式** + **Mermaid 图形** + Obsidian 方言(`[[wikilink]]` 内部跳转、`![[嵌入]]`、`> [!note]` callout、frontmatter、`==高亮==`) |
| `.sql` `.txt` `.json` 等文本 | 只读高亮 + 行号 |
| `.png` `.jpg` `.gif` `.webp` `.svg` | 直接显示,可切换「适应宽度 / 原始尺寸」 |
| `.epub` | 在线阅读(翻页、书内目录、字号、跟随主题) |
| `.pptx` `.xlsx` `.pdf` 等 | 新窗口打开,预览还是下载交给浏览器 |
| `.zip` | 不展示(归档类不解压也不下载,列出来只会干扰浏览) |

## 几个关键设计

**内容直接从你的磁盘读。** `pnpm run dev` 起的开发服务器挂了一个中间件(`tools/docs-server.mjs`),把 `/api/docs/tree`(列目录)与 `/api/docs/raw`(读文件)指向 `.env` 里的 `DOCS_DIR`。整个后端就这一个文件。

**为什么不做成能部署到 Cloudflare 的网站。** 部署在 Cloudflare 的网页跑在 Cloudflare 的机器上,**永远读不到你本机的磁盘**;要让线上能读,就必须先把内容上传到云端。而上传说到底要有个地方把仓库内容取出来 —— 这一环三条路我都实测过,没有一条可用:

| 取数方 | 结果 |
|---|---|
| Cloudflare Worker → gitee.com | **fetch 超时**(网络根本不通) |
| 浏览器 fetch → gitee.com | **403**(Gitee 的 WAF 拦浏览器) |
| 本机 Node 连续请求 → gitee.com | 前 150 个成功,**之后被风控限流成 403** |

既然只需要在本机读,那就根本不需要取数 —— 直接读文件。这条弯路的过程记在 PLAN.md 里。

**中文编码不会乱码。** 这个仓库里 2022 年前后的一批 SQL 是 GBK 的。服务端探测出非 UTF-8 后如实声明 `charset=gb18030`,前端按声明的编码解码。这里有个坑值得记一笔:Fetch 规范的 `response.text()` **一律按 UTF-8 解码、完全无视响应头里的 charset**,所以 `src/utils/api.ts` 是自己读 `arrayBuffer()` 再用 `TextDecoder` 解码的。

**Mermaid 图点击即全屏。** 正文里的图按「横向永不溢出 → 尽量整屏显示 → 最后才守可读下限」自适应;点一下打开全屏查看器,可拖拽平移、滚轮缩放(锚定光标),点击或 ESC 关闭。mermaid 本体约 1.4 MB,只在真的遇到图时才按需下载。

**字体是显式钉死的等宽字体。** 全站 Maple Mono NF CN,并且不依赖任何框架的间接传递:`@theme` 显式设 `--default-font-family`、`@layer base` 直接给 `html` 定字体、表单控件强制继承(浏览器默认会给它们另一套 UI 字体,是"字体看起来不对"最常见的原因)、`index.html` 预加载 400 字重以缩短 `font-display: swap` 期间显示系统字体的窗口。

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Vite 8 + React 18 + TypeScript(严格模式) |
| 样式 | Tailwind CSS v4 + daisyUI 5(浅色 `mycal` / 深色 `dim`) |
| 后端 | 无。仅一个 Vite 中间件读本机目录(`tools/docs-server.mjs`) |
| Markdown | markdown-it 15 + highlight.js 11(按需注册语言)+ KaTeX + DOMPurify |
| 图形 | Mermaid 11(动态加载,约 1.4 MB,只在遇到图时才下载) |
| 电子书 | epubjs(动态加载) |
| 字体 | Maple Mono NF CN 自托管 GB2312 子集(4 字重,约 6.7 MiB),显式钉死为全站字体 |

## 目录结构

```
src/            前端(React)
  components/   阅读区各视图、目录树、Mermaid 全屏查看器
  hooks/        数据获取、路由、栏宽
  utils/        Markdown 管线、高亮、Mermaid 尺寸、文件分类
tools/
  docs-server.mjs   本地文档服务(Vite 中间件,唯一的"后端")
  subset_fonts.py   重新生成字体子集
public/fonts/   提交进仓库的字体子集
```
