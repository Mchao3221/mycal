// 本地文档服务:开发服务器(Vite)直接读本机文档目录,提供 /api/docs/tree 与 /api/docs/raw。
//
// 为什么不是 Worker:Workerd 跑在沙箱里,读不到宿主机的任意文件;而且既然只在本机用,
// 也不需要任何服务端。这里用 Vite 插件挂两个中间件就够了 —— 没有云端、没有上传、没有访问码。
//
// 写成 .mjs 而不是 .ts:它不在 tsc 的检查范围里(src/ 与 worker/ 才是),
// 这样也不必为一个开发期插件引入 @types/node。
import { execFileSync } from 'node:child_process'
import { createReadStream, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

/** 与前端 src/utils/fileKind.ts 的分类保持同源:决定用哪种 Content-Type 下发 */
const TEXT_EXT = new Set([
  'md', 'markdown', 'txt', 'sql', 'json', 'excalidraw', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'css', 'scss', 'less', 'html', 'htm', 'xml', 'yml', 'yaml', 'toml', 'ini', 'conf', 'cfg',
  'sh', 'bash', 'ps1', 'bat', 'cmd', 'py', 'go', 'java', 'rb', 'rs', 'c', 'h', 'cpp', 'hpp',
  'cs', 'php', 'kt', 'swift', 'lua', 'pl', 'r', 'vue', 'svelte', 'log', 'csv', 'tsv',
])

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
  zip: 'application/zip',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

/** 不进阅读器的扩展名:归档类不解压也不下载,列在目录里只会干扰浏览 */
const IGNORED_EXT = new Set(['zip'])

const extOf = name => {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

/** 任何以 '.' 开头的路径段都视为隐藏(挡掉 .obsidian / .git / .tmp_xxx) */
const isHidden = rel => rel.split(/[\\/]/).some(seg => seg.startsWith('.'))

/**
 * 递归列目录。
 * 版本号用「大小 + 修改时间」而不是内容哈希:列一次目录不该把 9MB 全读一遍,
 * stat 就够了;文件一改 mtime 就变,前端拿到的 URL 也就变了,不会有陈旧缓存。
 */
function listFiles(root) {
  const out = []
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const rel = relative(root, full)
      if (isHidden(rel)) continue
      const st = statSync(full)
      if (st.isDirectory()) {
        stack.push(full)
      } else if (st.isFile()) {
        const ext = extOf(name)
        if (IGNORED_EXT.has(ext)) continue
        out.push({
          path: rel.split(sep).join('/'),
          size: st.size,
          sha: `${st.size}-${Math.round(st.mtimeMs)}`,
        })
      }
    }
  }
  return out
}

/** git HEAD,只用于顶栏显示;不是 git 仓库或没装 git 时返回空串 */
function gitRev(root) {
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

/** 合法 UTF-8 就声明 utf-8,否则如实声明 gb18030 —— 让浏览器按真实编码解码,中文才不会乱码 */
function textCharset(bytes) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return 'utf-8'
  } catch {
    return 'gb18030'
  }
}

function contentTypeFor(relPath, bytes) {
  const ext = extOf(relPath.split('/').pop() ?? '')
  if (TEXT_EXT.has(ext)) return `text/plain; charset=${bytes ? textCharset(bytes) : 'utf-8'}`
  return MIME[ext] ?? 'application/octet-stream'
}

function contentDisposition(relPath) {
  const name = relPath.split('/').pop() ?? 'file'
  const ascii = name.replace(/[^\u0020-\u007e]/g, '_').replace(/["\\]/g, '_')
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(body)
}

/** 把用户给的 path 解析成 root 内部的绝对路径;越界一律拒绝 */
function resolveInside(root, rawPath) {
  const trimmed = String(rawPath ?? '').replace(/^\/+/, '')
  if (!trimmed) throw new Error('缺少 path 参数')
  if (trimmed.includes('\\') || trimmed.includes('\0')) throw new Error('path 含非法字符')
  for (const seg of trimmed.split('/')) {
    if (!seg || seg === '.' || seg === '..') throw new Error('path 含非法路径段')
  }
  if (isHidden(trimmed)) throw new Error('path 指向隐藏项')
  const full = resolve(root, trimmed)
  if (full !== root && !full.startsWith(root + sep)) throw new Error('path 越出文档目录')
  return full
}

function makeHandler(root) {
  return (req, res, next) => {
    const url = new URL(req.url, 'http://localhost')
    if (!url.pathname.startsWith('/api/docs/')) return next()

    try {
      if (url.pathname === '/api/docs/tree') {
        const files = listFiles(root)
        return sendJson(res, {
          dir: root,
          rev: gitRev(root),
          fetchedAt: Date.now(),
          totalBytes: files.reduce((n, f) => n + f.size, 0),
          files,
        })
      }

      if (url.pathname === '/api/docs/raw') {
        const rel = String(url.searchParams.get('path') ?? '')
        const full = resolveInside(root, rel)
        const st = statSync(full)
        if (!st.isFile()) throw new Error('不是文件')

        const ext = extOf(full.split(sep).pop() ?? '')
        // 文本要先读出来判断编码,这几百 KB 的成本换来的是中文不乱码
        if (TEXT_EXT.has(ext)) {
          const bytes = readFileSync(full)
          res.statusCode = 200
          res.setHeader('Content-Type', contentTypeFor(rel, bytes))
          res.setHeader('Content-Length', String(bytes.byteLength))
          res.setHeader('Content-Disposition', contentDisposition(rel))
          // 本地文件随时可能被改,一律不缓存 —— 每次点开都是磁盘上的最新内容
          res.setHeader('Cache-Control', 'no-store')
          return res.end(bytes)
        }

        res.statusCode = 200
        res.setHeader('Content-Type', contentTypeFor(rel))
        res.setHeader('Content-Length', String(st.size))
        res.setHeader('Content-Disposition', contentDisposition(rel))
        res.setHeader('Cache-Control', 'no-store')
        return createReadStream(full).pipe(res)
      }

      return next()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // 文件不存在是最常见的情况(URL 里手写的路径、目录被改名),报 404 更准确
      const notFound = /ENOENT/.test(message)
      return sendJson(res, { error: notFound ? '文件不存在' : message }, notFound ? 404 : 400)
    }
  }
}

/** Vite 插件:dev 与 preview 两种模式下都挂同一套中间件 */
export function docsServer(docsDir) {
  const root = resolve(docsDir)
  return {
    name: 'mydocs-local-fs',
    configureServer(server) {
      server.middlewares.use(makeHandler(root))
    },
    configurePreviewServer(server) {
      server.middlewares.use(makeHandler(root))
    },
  }
}

export { IGNORED_EXT, TEXT_EXT }
