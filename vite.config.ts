import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  server: {
    host: true,
    port: 5173,
    // dev 模式下 /api 由 cloudflare 插件在本进程内运行 worker 处理,无需代理
  },
})
