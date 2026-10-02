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
    watch: {
      // cloudflare 插件会在 worker/ 下创建 .xxx.tmpdir/ 临时构建目录并从里面读文件,
      // 监听它会在 Windows 上撞 EBUSY(resource busy or locked)并直接打挂 dev 进程,必须忽略
      ignored: ['**/*.tmpdir/**', '**/.wrangler/**'],
    },
  },
})
