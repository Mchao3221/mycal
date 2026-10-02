// 按扩展名判断「用什么方式打开」以及「是不是文本」。
//
// 与 worker/docs.ts 里的 TEXT_EXT 基本同源:worker 用 TEXT_EXT 决定走 contents
// (会被 Gitee 规整成 UTF-8)还是 git/blobs(字节精确),这里的 CODE_EXT 决定前端按文本读。
// 唯一的例外是 `.excalidraw`:worker 仍当文本下发(新窗口里能读 JSON 原文),
// 但前端把它归到 external,不再做画布渲染。
import type { FileKind } from '../types'

const MARKDOWN_EXT = new Set(['md', 'markdown'])

/** 纯文本/源码:用 highlight.js 只读展示 */
const CODE_EXT = new Set([
  'txt', 'sql', 'json', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'css', 'scss', 'less', 'html', 'htm', 'xml', 'yml', 'yaml', 'toml', 'ini',
  'conf', 'cfg', 'sh', 'bash', 'ps1', 'bat', 'cmd', 'py', 'go', 'java', 'rb',
  'rs', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'kt', 'swift', 'lua', 'pl', 'r',
  'vue', 'svelte', 'log', 'csv', 'tsv',
])

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'ico', 'svg'])

/** 取扩展名(小写,不含点);无扩展名返回空串 */
export function extOf(path: string): string {
  const name = path.split('/').pop() ?? ''
  const i = name.lastIndexOf('.')
  // i > 0 而不是 i >= 0:挡掉 .gitignore 这类「整名就是扩展名」的隐藏文件
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

export function kindOf(path: string): FileKind {
  const ext = extOf(path)
  if (MARKDOWN_EXT.has(ext)) return 'markdown'
  if (ext === 'epub') return 'epub'
  if (IMAGE_EXT.has(ext)) return 'image'
  if (CODE_EXT.has(ext)) return 'code'
  // 其余一律新窗口打开,交给浏览器决定预览还是下载。
  // `.excalidraw` 走这条路:画布渲染已整体移除(官方包 1MB+),
  // worker 侧仍把它当文本下发,所以新窗口里能直接读到 JSON 原文,不会变成下载。
  return 'external'
}

/** 是否需要worker 把内容当文本取回(其余类型直接用 URL 当资源) */
export function isTextKind(path: string): boolean {
  const kind = kindOf(path)
  return kind === 'markdown' || kind === 'code'
}

/**
 * 文件在仓库内的路径 → worker 代理 URL。
 * sha 可选但很有用:带上它,worker 就能直接走 git/blobs 取内容,
 * 不必为了"把路径换成 sha"再拉一次完整文件树(那是两个上游请求)。
 */
export const rawUrl = (path: string, sha?: string): string =>
  `/api/docs/raw?path=${encodeURIComponent(path)}${sha ? `&sha=${sha}` : ''}`

/** 人类可读的字节数 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 左侧目录树用的文件标记。
 *
 * 刻意不引图标库(和项目"手写 SVG/不引库"的风格一致),但**必须一眼能分辨类型**:
 * 早先用的是 9px 灰色单字符,用户反馈"不够明显"。现在改成
 * 「按类型着色 + 稍大字号 + 固定宽度列」——颜色比形状在密集列表里更好扫。
 */
export function iconOf(path: string): string {
  switch (kindOf(path)) {
    case 'markdown':
      return 'M'
    case 'code':
      return extOf(path) === 'sql' ? 'S' : '{}'
    case 'image':
      return '▣'
    case 'epub':
      return 'B'
    default:
      return '·'
  }
}

/** 文件标记的配色:SQL 是仓库绝对主力,单独给一个醒目的颜色 */
export function iconToneOf(path: string): string {
  switch (kindOf(path)) {
    case 'markdown':
      return 'text-primary'
    case 'code':
      return extOf(path) === 'sql' ? 'text-accent' : 'text-base-content/45'
    case 'image':
      return 'text-secondary'
    case 'epub':
      return 'text-warning'
    default:
      return 'text-base-content/30'
  }
}
