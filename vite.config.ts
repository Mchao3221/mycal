import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const DEFAULT_PORT = 13627

// 需求管理 v0.1：前端 Vite + 后端 Cloudflare Worker + D1。
// 本地 dev 只跑前端，API 走 wrangler dev / 已部署 Worker（见 .env.example 的 VITE_API_BASE）。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: DEFAULT_PORT,
    strictPort: true,
    open: false,
  },
  preview: {
    host: true,
    port: DEFAULT_PORT,
    strictPort: true,
  },
})
