import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { docsServer } from './tools/docs-server.mjs'

/** 默认端口。取 13627 只因为它少见:3-6-2-7 是手机键盘上的 D-O-C-S,好记又不撞常见工具端口。 */
const DEFAULT_PORT = 13627

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
  const port = Number.parseInt(env.PORT ?? '', 10) || DEFAULT_PORT

  return {
    plugins: [react(), tailwindcss(), docsServer(docsDir)],
    server: {
      host: true,
      port,
      // 端口被占时直接报错退出,而不是悄悄挪到下一个端口 ——
      // 悄悄换端口会让浏览器书签、以及你自己记着的地址失效,是最难察觉的一种"冲突"。
      strictPort: true,
      open: false,
      watch: {
        // 不要删这条:工具写文件时会先在同目录建 `.<名字>.<pid>.<uuid>.tmpdir/`,
        // 监听它在 Windows 上会撞 EBUSY(resource busy or locked)并直接打挂 dev 进程。
        // 这已经被踩过两次(先前是 @cloudflare/vite-plugin 的 worker/.xxx.tmpdir/)。
        ignored: ['**/*.tmpdir/**'],
      },
    },
    preview: {
      host: true,
      port,
      strictPort: true,
    },
  }
})
