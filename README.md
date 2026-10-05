# 需求管理 v0.1

个人外化大脑：管公司多项目多需求，记得住、找得到，能应付追问。

- 前端：Vite + React + Tailwind + daisyUI
- 后端：Cloudflare Worker（`worker/`）+ D1（`mycal_db`，绑定 `mycalDB`）
- 数据只存链接索引，不存文件本身

## 跑起来

```bash
pnpm install
pnpm run dev              # 前端 :13627
wrangler dev              # 本地 API + 本地 D1（另开终端）
```

生产：`pnpm run deploy`（先 build 再 wrangler deploy，前端走 Worker assets）。

## 数据库

表见 `migrations/0001_req.sql`：projects / requirements / req_links / req_fts(FTS5)。
线上迁移由维护人在 Cloudflare 控制台/命令行执行（见 PLAN）。
