import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // 开发模式下 API 代理到本地后端
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
})
