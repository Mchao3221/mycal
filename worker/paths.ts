// 路径与 MIME 相关的纯函数,读写两侧共用。
import { HttpError } from './http'

export const MIME: Record<string, string> = {
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

/**
 * 文本类一律按 text/plain 下发:前端自己渲染,同时避免仓库里的 HTML 在本站执行。
 * 与前端 src/utils/fileKind.ts 的 MARKDOWN_EXT + CODE_EXT 基本同源
 * (唯一例外 `.excalidraw`:这里当文本下发,前端归到 external 不做画布渲染)。
 *
 * 这张表在同步架构下还多了一个作用:**决定这个文件走哪条取数路径** ——
 * 文本走 contents(会被 Gitee 规整成 UTF-8),二进制走 git/blobs(原始字节)。
 */
export const TEXT_EXT = new Set([
  'md', 'markdown', 'txt', 'sql', 'json', 'excalidraw', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'css', 'scss', 'less', 'html', 'htm', 'xml', 'yml', 'yaml', 'toml', 'ini', 'conf', 'cfg',
  'sh', 'bash', 'ps1', 'bat', 'cmd', 'py', 'go', 'java', 'rb', 'rs', 'c', 'h', 'cpp', 'hpp',
  'cs', 'php', 'kt', 'swift', 'lua', 'pl', 'r', 'vue', 'svelte', 'log', 'csv', 'tsv',
])

/** 取扩展名(小写,不含点);无扩展名返回空串 */
export function extOf(path: string): string {
  const name = path.split('/').pop() ?? ''
  const i = name.lastIndexOf('.')
  // i > 0 而不是 i >= 0:挡掉 .gitignore 这类「整名就是扩展名」的隐藏文件
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

export const isTextPath = (path: string): boolean => TEXT_EXT.has(extOf(path))

/** 任何以 '.' 开头的路径段都视为隐藏:挡掉 .obsidian/、.tmp_legal_ch3/、.gitignore */
export function isHidden(path: string): boolean {
  return path.split('/').some(seg => seg.startsWith('.'))
}

/**
 * 校验并规范化客户端传来的 path。
 * 同时挡住目录穿越(../)、空段(//)、反斜杠与控制字符,保证拼出来的 URL
 * 永远落在仓库内部,不会变成第二个主机名。
 */
export function normPath(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) throw new HttpError(400, '缺少 path 参数')
  if (trimmed.length > 1024) throw new HttpError(400, 'path 过长')
  const path = trimmed.replace(/^\/+/, '')
  if (!path) throw new HttpError(400, 'path 不能为空')
  if (path.includes('\\')) throw new HttpError(400, 'path 含非法字符')
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) throw new HttpError(400, 'path 含控制字符')
  if (/[?#]/.test(path)) throw new HttpError(400, 'path 含非法字符')
  for (const seg of path.split('/')) {
    if (!seg || seg === '.' || seg === '..') throw new HttpError(400, 'path 含非法路径段')
  }
  return path
}

/** git blob sha 的形状校验:客户端数据不直接拼进 URL */
export const isBlobSha = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{40}$/i.test(v)

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * 文本响应类型。
 * 同步时文本走 contents(已是 UTF-8),但为了兜住「同步时 contents 失败、退回 blobs」
 * 的旧编码文件,这里仍然验一次:不是合法 UTF-8 就把真实编码写进 charset,
 * 交给浏览器去解码,绝不让中文变成乱码。
 */
export function textContentType(bytes: Uint8Array): string {
  try {
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
    return 'text/plain; charset=utf-8'
  } catch {
    return 'text/plain; charset=gb18030'
  }
}

export function contentTypeFor(path: string, bytes?: Uint8Array): string {
  if (isTextPath(path)) return bytes ? textContentType(bytes) : 'text/plain; charset=utf-8'
  return MIME[extOf(path)] ?? 'application/octet-stream'
}

/** inline + 双写 filename:中文名在 Chrome 里也能拿到正确的下载名 */
export function contentDisposition(path: string): string {
  const name = path.split('/').pop() ?? 'file'
  const ascii = name.replace(/[^\u0020-\u007e]/g, '_').replace(/["\\]/g, '_')
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}
