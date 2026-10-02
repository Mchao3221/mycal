// 代码高亮的唯一入口。
//
// 刻意用 highlight.js/lib/core + 按需注册语言,而不是 `import hljs from 'highlight.js'`:
// 后者会把 190 多种语言全打进包里(约 1MB)。这个仓库的代码全是 SQL,再带上几种常见格式
// 就够用了,没注册的语言统一走 plaintext 兜底(不报错、只是不着色)。
// 颜色不在这里管,由 src/styles.css 按主题手写 .hljs-* 规则。
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import ini from 'highlight.js/lib/languages/ini'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import plaintext from 'highlight.js/lib/languages/plaintext'
import powershell from 'highlight.js/lib/languages/powershell'
import python from 'highlight.js/lib/languages/python'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

/** 注册过的语言名 → 模块;顺序无关,查表用 */
const LANGUAGES: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
  bash,
  css,
  ini,
  javascript,
  json,
  markdown,
  plaintext,
  powershell,
  python,
  sql,
  typescript,
  xml,
  yaml,
}

let registered = false
function ensureRegistered(): void {
  if (registered) return
  for (const [name, lang] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, lang)
  registered = true
}

/** 扩展名 → highlight.js 语言名(未收录的返回 null) */
const EXT_LANG: Record<string, string> = {
  sql: 'sql',
  json: 'json',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  css: 'css',
  scss: 'css',
  less: 'css',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  vue: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  conf: 'ini',
  cfg: 'ini',
  sh: 'bash',
  bash: 'bash',
  ps1: 'powershell',
  bat: 'powershell',
  cmd: 'powershell',
  py: 'python',
  md: 'markdown',
  markdown: 'markdown',
  txt: 'plaintext',
  log: 'plaintext',
  csv: 'plaintext',
  tsv: 'plaintext',
}

export function languageOf(path: string): string | null {
  const name = path.split('/').pop() ?? ''
  const i = name.lastIndexOf('.')
  if (i <= 0) return null
  return EXT_LANG[name.slice(i + 1).toLowerCase()] ?? null
}

/** 是否注册过这门语言(没注册就别让 hljs 去高亮,否则只会得到纯文本) */
export function hasLanguage(lang: string): boolean {
  ensureRegistered()
  return hljs.getLanguage(lang) !== undefined
}

/**
 * 自动识别语言,只在已注册的这十几种里挑。
 *
 * 两道门槛都是实测定下来的:
 *  1. 太短的内容不猜 —— 实测 `just plain text` 会被识别成 css 并把 "text" 染成选择器,
 *     与其给一段普通文字上错误的颜色,不如老老实实显示纯文本;
 *  2. 太长的内容不扫 —— highlightAuto 要把每种语言都试一遍,对大文件很慢。
 * 语言少了是相对「全量 highlight.js」的取舍:换来的是快得多的识别和约 1MB 的包体积。
 */
export function highlightAutoCode(text: string, sizeGuard = 200_000): { html: string; lang: string } | null {
  if (text.length > sizeGuard) return null
  const lines = text.split('\n').length
  if (text.length < 60 && lines < 3) return null
  ensureRegistered()
  try {
    const auto = hljs.highlightAuto(text)
    if (auto.value === '' || typeof auto.language !== 'string') return null
    return { html: auto.value, lang: auto.language }
  } catch {
    return null
  }
}

/**
 * 代码块高亮:指定语言优先,识别不出来再自动识别,都不行返回 null。
 * 返回 null 时由调用方决定怎么兜底(通常是 HTML 转义后平铺展示)。
 * Markdown 渲染与源码视图共用这一个入口,保证两处着色完全一致。
 */
export function highlightBlock(code: string, langRaw: string): { html: string; lang: string } | null {
  const wanted = langRaw.trim().toLowerCase()
  if (wanted !== '' && hasLanguage(wanted)) {
    ensureRegistered()
    try {
      return { html: hljs.highlight(code, { language: wanted, ignoreIllegals: true }).value, lang: wanted }
    } catch {
      /* 落到自动识别 */
    }
  }
  return highlightAutoCode(code)
}

/**
 * 高亮成 HTML 片段(不含外层 <pre><code>,由调用方决定容器)。
 * 超过 sizeGuard 字节就不高亮了:600KB 的 SQL 交给 hljs 要卡住主线程一秒以上,
 * 这种文件多半是导出脚本,平铺展示反而更好读。
 */
export function highlightCode(text: string, lang: string | null, sizeGuard = 400_000): { html: string; plain: boolean } {
  if (text.length > sizeGuard) return { html: escapeHtml(text), plain: true }
  ensureRegistered()
  if (lang && hljs.getLanguage(lang)) {
    return { html: hljs.highlight(text, { language: lang, ignoreIllegals: true }).value, plain: false }
  }
  // 没识别出语言:不做 highlightAuto(它要试遍所有语言,对长文件太慢),直接纯文本
  return { html: escapeHtml(text), plain: true }
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, ch => {
    switch (ch) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}
