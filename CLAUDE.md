# CLAUDE.md

需求管理 v0.1：Vite + React 18 + TS严格 + Tailwind v4 + daisyUI，前端 `src/`；后端 Worker `worker/` + D1。

## 命令
```bash
pnpm install            # pnpm v11，不要用 npm
pnpm run dev            # 前端 :13627（strictPort）
wrangler dev            # 本地 API + 本地 D1
pnpm run build          # tsc(front) + tsc(worker) + vite build
pnpm run deploy         # build + wrangler deploy
```

## 约定
- D1 绑定名 `mycalDB` 不要改（复用线上已有绑定，见 `wrangler.jsonc`）。
- 新迁移放 `migrations/`，命名递增，`IF NOT EXISTS` 幂等。
- 中文 UI/注释/提交信息。
- `tsconfig.json` 只含 `src`，`tsconfig.worker.json` 只含 `worker`。
