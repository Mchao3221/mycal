import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { docsServer } from './tools/docs-server.mjs'

/**
 * 本地只读阅读器(v0.7.0)。
 *
 * 文档内容不再来自云端,也不再需要同步:这个开发服务器直接读本机目录
 * (`DOCS_DIR`,默认 C:\03Docs\my-docs),把 /api/docs/* 两个接口指向磁盘。
 * 所以这里没有 Cloudflare 插件、没有 worker、没有 D1、没有访问码。
 */
export default defineConfig(({ mode }) => {
  // 第三个参数传 '' 表示把 .env 里的变量也读进来(而不只是 VITE_ 前缀的)
  const env = loadEnv(mode, process.cwd(), '')
  const docsDir = env.DOCS_DIR || 'C:\\03Docs\\my-docs'

  return {
    plugins: [react(), tailwindcss(), docsServer(docsDir)],
    server: {
      host: true,
      port: 5173,
      open: false,
      watch: {
        // 不要删这条:工具写文件时会先在同目录建 `.<名字>.<pid>.<uuid>.tmpdir/`,
        // 监听它在 Windows 上会撞 EBUSY(resource busy or locked)并直接打挂 dev 进程。
        // 这已经被踩过两次(先前是 @cloudflare/vite-plugin 的 worker/.xxx.tmpdir/)。
        ignored: ['**/*.tmpdir/**'],
      },
    },
  }
})
