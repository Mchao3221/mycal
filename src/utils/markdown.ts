/**
 * Markdown 渲染管线(只读文档阅读器专用)
 *
 * 纯函数模块:不依赖 React,也不引用仓库内其它 src 文件。
 * 覆盖能力:
 *   1. GFM 基础语法(markdown-it + 任务列表渲染成禁用 checkbox)
 *   2. 代码高亮(highlight.js;不引任何 hljs 主题 CSS,色值由 src/styles.css 决定)
 *   3. KaTeX 行内 / 块级公式($...$、$$...$$)
 *   4. Obsidian 方言:wikilink、嵌入、callout、frontmatter、==高亮==、:emoji:
 *   5. 资源路径重写(仓库内图片 / 附件走 Worker 代理,仓库内文档走内部路由)
 *   6. DOMPurify 消毒(拦截 script、事件属性、javascript: 协议)
 */

// KaTeX 样式(公式排版必需;颜色 / 字号仍由 styles.css 覆盖)
import 'katex/dist/katex.min.css'
import DOMPurify from 'dompurify'
import katex from 'katex'
import { highlightBlock } from './highlight'
// markdown-it 15 自带声明里的类类型不方便直接当类型用,这里统一起别名(仅类型,零运行时开销)
import MarkdownIt, {
  type Env,
  type MarkdownIt as MarkdownItInstance,
  type StateBlock,
  type StateCore,
  type StateInline,
  type Token,
  type Token as TokenClass,
} from 'markdown-it'

// ---------------------------------------------------------------------------
// 对外接口
// ---------------------------------------------------------------------------

/** 文档大纲的一项 */
export interface OutlineItem {
  /** 标题级别 1~6 */
  level: number
  /** 标题纯文本 */
  text: string
  /** 对应 HTML 里标题的 id */
  id: string
}

/** 一次渲染的结果 */
export interface RenderedDoc {
  /** 已消毒的最终 HTML */
  html: string
  /** 文档大纲 */
  outline: OutlineItem[]
  /** frontmatter(没有就是 null) */
  meta: Record<string, string> | null
}

/** 渲染选项 */
export interface RenderOptions {
  /** 当前文档在仓库内的相对路径,如 '00_收集箱/7123.md' */
  docPath: string
  /** 仓库内所有文件路径,用于解析 Obsidian wikilink */
  knownPaths: Set<string>
}

/** 渲染上下文,随 env 传进 renderer */
interface RenderContext {
  /** 当前文档所在目录 */
  docDir: string
  /** 已知路径(已规范化) */
  knownPaths: Set<string>
  /** 小写路径 -> 真实路径 */
  lowerMap: Map<string, string>
  /** basename(小写、去 .md)-> 同名路径列表 */
  baseMap: Map<string, string[]>
  /** 大纲收集目标(core 规则写入) */
  outline: OutlineItem[]
}

/** renderer / core 规则里从 env 取上下文的键名 */
const ENV_CTX_KEY = '__mycalCtx'

/** 构造渲染 env(Env 允许放任意键) */
function makeEnv(ctx: RenderContext): Env {
  return { [ENV_CTX_KEY]: ctx }
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** callout 类型 -> 中文名 */
const CALLOUT_LABELS: Record<string, string> = {
  note: '笔记',
  tip: '提示',
  warning: '警告',
  danger: '危险',
  info: '信息',
  important: '重要',
  question: '问题',
  example: '示例',
  quote: '引用',
  success: '成功',
  failure: '失败',
  bug: '缺陷',
  abstract: '摘要',
  todo: '待办',
}

/** 外部地址:协议、协议相对、锚点、data/blob 一律不重写 */
const EXTERNAL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|data:|blob:)/i

/** 图片扩展名(wikilink 嵌入判定) */
const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|bmp|avif)$/i

/** :emoji: 短代码表(只收录常用的,未命中就原样输出) */
const EMOJI_MAP: Record<string, string> = {
  smile: '🙂',
  joy: '😂',
  wink: '😉',
  heart: '❤️',
  thumbsup: '👍',
  thumbsdown: '👎',
  fire: '🔥',
  star: '⭐',
  warning: '⚠️',
  check: '✅',
  x: '❌',
  bulb: '💡',
  rocket: '🚀',
  tada: '🎉',
  pray: '🙏',
  clap: '👏',
  eyes: '👀',
  cry: '😢',
  sweat_smile: '😅',
  thinking: '🤔',
  point_right: '👉',
  zap: '⚡',
  wave: '👋',
  ok_hand: '👌',
  muscle: '💪',
}

/** DOMPurify 允许的标签(HTML + SVG + KaTeX 需要的 MathML) */
const ALLOWED_TAGS = [
  // 常用 HTML
  'a', 'abbr', 'article', 'aside', 'b', 'blockquote', 'br', 'caption', 'code', 'col', 'colgroup',
  'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'hr', 'i', 'img', 'input', 'ins', 'kbd', 'label', 'li', 'main', 'mark', 'ol', 'p',
  'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'section', 'small', 'span', 'strong', 'sub', 'summary',
  'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul', 'var', 'wbr',
  // SVG(KaTeX 的 sqrt 线、箭头等)
  'svg', 'path', 'g', 'rect', 'circle', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs',
  'use', 'marker', 'clipPath', 'mask', 'pattern', 'symbol', 'title', 'desc',
  // MathML(KaTeX 的无障碍层)
  'math', 'semantics', 'annotation', 'mrow', 'mi', 'mn', 'mo', 'ms', 'mtext', 'msup', 'msub',
  'msubsup', 'mfrac', 'msqrt', 'mroot', 'mover', 'munder', 'munderover', 'mtable', 'mtr', 'mtd',
  'mspace', 'mpadded', 'mphantom', 'mstyle', 'menclose', 'merror', 'mlabeledtr', 'mmultiscripts',
  'mprescripts', 'none', 'mstack', 'mlongdiv', 'msgroup', 'mscarries', 'mscarry', 'msline',
  'mglyph', 'maction',
]

/** DOMPurify 允许的属性(data-* 由 ALLOW_DATA_ATTR 放行) */
const ALLOWED_ATTR = [
  'class', 'id', 'href', 'src', 'alt', 'title', 'loading', 'type', 'checked', 'disabled', 'start',
  'value', 'colspan', 'rowspan', 'scope', 'align', 'dir', 'lang', 'style', 'target', 'rel',
  'width', 'height', 'role', 'open', 'name',
  // MathML
  'xmlns', 'display', 'mathvariant', 'stretchy', 'fence', 'separator', 'accent', 'accentunder',
  'columnalign', 'rowalign', 'columnspacing', 'rowspacing', 'columnlines', 'rowlines', 'linethickness',
  'lspace', 'rspace', 'displaystyle', 'scriptlevel', 'movablelimits', 'bevelled', 'notation',
  'largeop', 'symmetric', 'minsize', 'maxsize', 'form', 'encoding', 'voffset', 'depth', 'lquote',
  'rquote', 'numalign', 'denomalign', 'stackalign', 'longdivstyle', 'actiontype',
  // KaTeX 输出会出现的 SVG 属性
  'viewBox', 'preserveAspectRatio', 'd', 'fill', 'fill-rule', 'fill-opacity', 'stroke',
  'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-opacity',
  'transform', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'points',
  'offset', 'stop-color', 'stop-opacity', 'clip-path', 'markerWidth', 'markerHeight', 'refX', 'refY',
  'orient', 'text-anchor', 'dominant-baseline', 'font-size', 'font-family', 'xmlns:xlink', 'xlink:href',
]

/** 一律禁止的标签(显式声明,避免意外放行) */
const FORBID_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'base']

// ---------------------------------------------------------------------------
// 字符串 / 路径工具
// ---------------------------------------------------------------------------

/** HTML 转义 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 简版反转义(解码常见实体) */
function unescapeHtml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

/**
 * 还原 markdown-it 归一化时做的 percent 编码。
 * markdown-it 会把 href / src 过一遍 encodeURI,仓库里带中文的路径会变成 %E5%8F%82…
 * 这里解回来,后面统一用自己的 encodeURIComponent 重新编码,避免二次编码。
 * 解不开的片段(比如文件名里真有 %)原样保留。
 */
function decodePercent(text: string): string {
  if (!text.includes('%')) return text
  try {
    return decodeURIComponent(text)
  } catch {
    return text.replace(/%[0-9A-Fa-f]{2}/g, (seq) => {
      try {
        return decodeURIComponent(seq)
      } catch {
        return seq
      }
    })
  }
}

/** 去掉 HTML 标签得到纯文本 */
function plainTextOf(html: string): string {
  return unescapeHtml(html.replace(/<[^>]*>/g, '')).trim()
}

/** 反斜杠转正斜杠、压缩重复斜杠 */
function toSlashes(raw: string): string {
  return raw.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
}

/** 规范化仓库内相对路径 */
function normalizePath(raw: string): string {
  let out = toSlashes(raw.trim())
  while (out.startsWith('./')) out = out.slice(2)
  while (out.startsWith('/')) out = out.slice(1)
  return out
}

/** 相对 baseDir 解析路径,正确处理 ./ 与 ../ */
function resolveRelativePath(baseDir: string, relativePath: string): string {
  const segments = baseDir === '' ? [] : baseDir.split('/').filter((seg) => seg !== '')
  for (const segment of toSlashes(relativePath.trim()).split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      // 越出仓库根时丢弃该段,避免产出脏路径
      if (segments.length > 0) segments.pop()
      continue
    }
    segments.push(segment)
  }
  return segments.join('/')
}

/** 取路径的目录部分 */
function dirName(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? '' : path.slice(0, idx)
}

/** 取文件名部分 */
function baseName(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? path : path.slice(idx + 1)
}

/** 抹掉 .md / .markdown 后缀 */
function stripMdExtension(path: string): string {
  return path.replace(/\.(?:md|markdown)$/i, '')
}

/**
 * 生成 GitHub 风格的标题 slug,**必须保留中文**。
 *
 * 这个仓库的 README 自己就写了 `[一、设计理念](#一设计理念)` 这种目录,
 * 而 GitHub 的规则是「小写 → 去掉标点 → 空格转 '-'」:中文属于字母会被保留,
 * `、` 属于标点会被去掉,于是 `一、设计理念` 正好得到 `一设计理念`,与仓库里手写的锚点对得上。
 * 若只保留 ASCII,所有中文标题的锚点都会失效。
 */
function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    // \p{L} / \p{N} 覆盖所有语言的字母与数字(含中日韩);下划线、连字符原样保留
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

// ---------------------------------------------------------------------------
// 上下文与路径解析
// ---------------------------------------------------------------------------

/** 构造渲染上下文(每次渲染一次,索引建好后查询都是 O(1)) */
function createContext(opts: RenderOptions): RenderContext {
  const knownPaths = new Set<string>()
  for (const raw of opts.knownPaths) {
    const path = normalizePath(raw)
    if (path !== '') knownPaths.add(path)
  }

  const lowerMap = new Map<string, string>()
  const baseMap = new Map<string, string[]>()
  for (const path of knownPaths) {
    const lower = path.toLowerCase()
    if (!lowerMap.has(lower)) lowerMap.set(lower, path)

    const key = stripMdExtension(baseName(lower))
    const bucket = baseMap.get(key)
    if (bucket === undefined) baseMap.set(key, [path])
    else bucket.push(path)
  }

  return {
    docDir: dirName(normalizePath(opts.docPath)),
    knownPaths,
    lowerMap,
    baseMap,
    outline: [],
  }
}

/** basename 命中多个时取路径最短(同长度按字典序,保证结果稳定) */
function pickShortest(paths: string[]): string | null {
  if (paths.length === 0) return null
  let best = paths[0] ?? null
  for (const path of paths) {
    if (best === null) {
      best = path
      continue
    }
    if (path.length < best.length || (path.length === best.length && path < best)) best = path
  }
  return best
}

/** 仓库内相对路径 -> Worker 资源代理地址 */
function rawUrl(repoPath: string): string {
  return '/api/docs/raw?path=' + encodeURIComponent(repoPath)
}

/**
 * 内部文档跳转地址。
 * 用查询串 `?doc=` 而不是 hash `#/doc/`:hash 要留给标题锚点
 * (仓库 README 自己就写了 `[一、设计理念](#一设计理念)` 这种目录),
 * 文档路由再占用 hash 就会和锚点互相冲掉。路由实现见 src/hooks/useDocRoute.ts。
 */
function docHref(repoPath: string, headingAnchor: string): string {
  return '?doc=' + encodeURIComponent(repoPath) + headingAnchor
}

/**
 * wikilink / 嵌入目标的解析,按优先级:
 * ① knownPaths 精确命中 ② 命中 目标.md ③ 忽略大小写 ④ basename 匹配(取路径最短)
 */
function resolveTarget(ctx: RenderContext, rawTarget: string): string | null {
  const target = normalizePath(rawTarget)
  if (target === '') return null

  const candidates: string[] = [target]
  if (!/\.(?:md|markdown)$/i.test(target)) {
    candidates.push(target + '.md', target + '.markdown')
  }

  // ①② 精确命中(以仓库根为基准)
  for (const candidate of candidates) {
    if (ctx.knownPaths.has(candidate)) return candidate
  }

  // ③ 忽略大小写
  for (const candidate of candidates) {
    const hit = ctx.lowerMap.get(candidate.toLowerCase())
    if (hit !== undefined) return hit
  }

  // ③(补)相对当前文档目录解析后再试
  if (ctx.docDir !== '') {
    for (const candidate of candidates) {
      const joined = ctx.docDir + '/' + candidate
      if (ctx.knownPaths.has(joined)) return joined
      const hit = ctx.lowerMap.get(joined.toLowerCase())
      if (hit !== undefined) return hit
    }
  }

  // ④ basename 匹配
  for (const candidate of [target, target + '.md']) {
    const key = stripMdExtension(baseName(candidate)).toLowerCase()
    const hit = pickShortest(ctx.baseMap.get(key) ?? [])
    if (hit !== null) return hit
  }

  return null
}

/**
 * 把 Markdown 里的资源地址解析成仓库内相对路径。
 * 外链 / 锚点 / data: 返回 null(保持原样)。
 */
function resolveResourcePath(ctx: RenderContext, href: string): string | null {
  const trimmed = href.trim()
  if (trimmed === '' || EXTERNAL_RE.test(trimmed)) return null
  const withoutHash = (trimmed.split('#')[0] ?? '').split('?')[0] ?? ''
  if (withoutHash === '') return null
  if (withoutHash.startsWith('/')) return normalizePath(withoutHash)
  return resolveRelativePath(ctx.docDir, withoutHash)
}

// ---------------------------------------------------------------------------
// 安全消毒
// ---------------------------------------------------------------------------

/**
 * 最终 HTML 一律过 DOMPurify。
 * 放行 class / id / data-* / style(KaTeX 需要)等,拦截 script、事件属性与 javascript: 协议。
 */
function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: true,
    ALLOW_ARIA_ATTR: true,
    FORBID_TAGS,
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onmouseenter'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|ftp|data|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
  })
}

// ---------------------------------------------------------------------------
// 数学公式
// ---------------------------------------------------------------------------

/** 调 KaTeX;出任何问题都退化为纯文本,不让整篇文档挂掉 */
function renderTex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, { throwOnError: false, displayMode })
  } catch {
    return '<code class="math-error">' + escapeHtml(tex) + '</code>'
  }
}

/** 判断是否空白字符码点 */
function isSpaceCode(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d
}

/**
 * 行内 $...$。启发式:
 *  - 开头 $ 之后不能是空白 / 不能是另一个 $(交给块级规则)
 *  - 结尾 $ 之前不能是空白,内容里不能有换行、不能为空
 *  - 支持 \$ 转义(遇到反斜杠跳过两个字符)
 * 这样「价格是 $5 到 $10」因为结尾 $ 前面是空格而被判为非公式。
 */
function mathInlineRule(state: StateInline, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x24 /* $ */) return false

  const start = state.pos
  const after = state.src.charCodeAt(start + 1)
  if (after === 0x24) return false
  if (Number.isNaN(after) || isSpaceCode(after)) return false

  let pos = start + 1
  let close = -1
  while (pos < state.posMax) {
    const code = state.src.charCodeAt(pos)
    if (code === 0x0a) return false
    if (code === 0x5c /* \ */) {
      pos += 2
      continue
    }
    if (code === 0x24) {
      if (isSpaceCode(state.src.charCodeAt(pos - 1))) return false
      close = pos
      break
    }
    pos += 1
  }
  if (close === -1) return false

  const content = state.src.slice(start + 1, close)
  if (content.trim() === '') return false
  if (silent) return true

  const token = state.push('math_inline', 'math', 0)
  token.content = content
  token.markup = '$'
  state.pos = close + 1
  return true
}

/** 块级 $$...$$,支持单行 $$x$$ 与跨行 */
function mathBlockRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const begin = state.bMarks[startLine]! + state.tShift[startLine]!
  const end = state.eMarks[startLine]!
  if (!state.src.startsWith('$$', begin)) return false
  if (state.sCount[startLine]! - state.blkIndent >= 4) return false
  if (silent) return true

  const firstLine = state.src.slice(begin, end)
  let content = ''
  let nextLine = startLine + 1

  if (firstLine.length > 4 && firstLine.trimEnd().endsWith('$$')) {
    content = firstLine.trimEnd().slice(2, -2)
  } else {
    const tail = firstLine.slice(2)
    if (tail.trim() !== '') content += tail + '\n'
    let closed = false
    while (nextLine < endLine) {
      const line = state.src.slice(state.bMarks[nextLine]! + state.tShift[nextLine]!, state.eMarks[nextLine]!)
      const closeIdx = line.indexOf('$$')
      if (closeIdx !== -1) {
        content += line.slice(0, closeIdx)
        closed = true
        nextLine += 1
        break
      }
      content += line + '\n'
      nextLine += 1
    }
    if (!closed) return false
  }

  const token = state.push('math_block', 'math', 0)
  token.block = true
  token.content = content.trim()
  token.map = [startLine, nextLine]
  token.markup = '$$'
  state.line = nextLine
  return true
}

// ---------------------------------------------------------------------------
// Obsidian:==高亮== / :emoji: / wikilink
// ---------------------------------------------------------------------------

/** ==高亮== -> <mark> */
function markRule(state: StateInline, silent: boolean): boolean {
  const start = state.pos
  if (state.src.charCodeAt(start) !== 0x3d /* = */) return false
  if (state.src.charCodeAt(start + 1) !== 0x3d) return false
  // 避免吃掉 === 这类分隔线 / 表情符号
  if (state.src.charCodeAt(start - 1) === 0x3d) return false
  if (state.src.charCodeAt(start + 2) === 0x3d) return false

  const close = state.src.indexOf('==', start + 2)
  if (close === -1) return false
  const inner = state.src.slice(start + 2, close)
  if (inner.trim() === '' || inner.includes('\n')) return false
  if (silent) return true

  const open = state.push('mark_open', 'mark', 1)
  open.markup = '=='
  const text = state.push('text', '', 0)
  text.content = inner
  const closeToken = state.push('mark_close', 'mark', -1)
  closeToken.markup = '=='
  state.pos = close + 2
  return true
}

/** :emoji: 短代码;未命中时返回 false 交给 text 规则 */
function emojiRule(state: StateInline, silent: boolean): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x3a /* : */) return false
  const match = /^:([A-Za-z0-9_+-]{1,32}):/.exec(state.src.slice(state.pos, state.pos + 36))
  if (match === null) return false
  const emoji = EMOJI_MAP[(match[1] ?? '').toLowerCase()]
  if (emoji === undefined) return false
  if (silent) return true

  const token = state.push('text', '', 0)
  token.content = emoji
  state.pos += match[0].length
  return true
}

/** [[目标]] / [[目标|文字]] / [[目标#小节]] / ![[嵌入]] */
function wikilinkRule(state: StateInline, silent: boolean): boolean {
  const start = state.pos
  const isEmbed = state.src.charCodeAt(start) === 0x21 /* ! */
  const openLen = isEmbed ? 3 : 2
  if (!state.src.startsWith(isEmbed ? '![[' : '[[', start)) return false

  const bodyStart = start + openLen
  const close = state.src.indexOf(']]', bodyStart)
  if (close === -1) return false
  const body = state.src.slice(bodyStart, close)
  if (body.includes('\n') || body.trim() === '') return false
  if (silent) return true

  const token = state.push('obsidian_embed', '', 0)
  token.content = body
  token.markup = isEmbed ? '![[' : '[['
  state.pos = close + 2
  return true
}

// ---------------------------------------------------------------------------
// Obsidian:callout
// ---------------------------------------------------------------------------

/** callout 头部:`[!note] 标题` / `[!note]- 标题` / `[!note]+ 标题` */
const CALLOUT_HEAD_RE = /^\[!([A-Za-z][A-Za-z0-9_-]*)\]([+-]?)(?:[ \t]+(.*))?$/

/**
 * > [!note] 标题
 * > 正文…
 *
 * `-` 默认折叠(最外层加 is-collapsed),`+` 默认展开。
 *
 * 实现:照搬 markdown-it 的 blockquote 规则扫出引用块范围,再把每行 `>` 剥掉。
 * blockquote 的换行会被还原,所以列表这类多行块要靠"懒 continuation"被 markdown-it
 * 自己吃掉;只有单行成块的情况需要额外把 tShift 挪到 `>` 之后(见 patchSingleLine)。
 */
function calloutRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const pos = state.bMarks[startLine]! + state.tShift[startLine]!
  const max = state.eMarks[startLine]!
  if (state.sCount[startLine]! - state.blkIndent >= 4) return false
  if (state.src.charCodeAt(pos) !== 0x3e /* > */) return false
  const headMatch = CALLOUT_HEAD_RE.exec(state.src.slice(pos + 1, max).trim())
  if (headMatch === null) return false
  if (silent) return true

  const type = (headMatch[1] ?? 'note').toLowerCase()
  const marker = headMatch[2] ?? ''
  const customTitle = (headMatch[3] ?? '').trim()

  // 1) 扫描引用块范围,逐行剥掉 `>` 与对齐空白
  const bodyLines: string[] = []
  let nextLine = startLine
  let lastLineEmpty = false

  for (; nextLine < endLine; nextLine += 1) {
    const isOutdented = state.sCount[nextLine]! < state.blkIndent
    const lineBegin = state.bMarks[nextLine]! + state.tShift[nextLine]!
    const lineEnd = state.eMarks[nextLine]!
    let cursor = lineBegin

    // 空行直接结束引用块(与 blockquote 一致)
    if (cursor >= lineEnd) break

    if (state.src.charCodeAt(cursor) === 0x3e /* > */ && !isOutdented) {
      cursor += 1
      // 吃掉一个空格 / 制表符,再跳过剩余的对齐空白
      while (cursor < lineEnd && isSpaceCode(state.src.charCodeAt(cursor))) cursor += 1
      lastLineEmpty = cursor >= lineEnd
      bodyLines.push(state.src.slice(cursor, lineEnd))
      continue
    }

    if (lastLineEmpty) break

    // 用 blockquote 的终结规则判断:围栏 / 标题 / 分隔线 / 列表 / HTML 等一律结束引用
    let terminate = false
    for (const rule of state.md.block.ruler.getRules('blockquote')) {
      if (rule(state, nextLine, endLine, true)) {
        terminate = true
        break
      }
    }
    if (terminate) break
    // 懒 continuation:该行没有 `>`,但仍属于引用块内的段落
    bodyLines.push(state.src.slice(lineBegin, lineEnd))
  }

  // 2) 拼装 callout 结构(callout 头那一行不参与渲染)
  const open = new state.Token('callout_open', 'div', 1)
  open.block = true
  open.attrSet('class', 'callout callout-' + type)
  open.attrSet('data-callout', type)
  open.attrSet('data-collapsible', marker === '+' ? 'open' : marker === '-' ? 'closed' : 'none')

  // 标题:用自定义 token 承载标题文字,渲染时再套 .callout-title
  const titleToken = new state.Token('callout_title', '', 0)
  titleToken.block = true
  titleToken.content = customTitle === '' ? CALLOUT_LABELS[type] ?? type : customTitle
  titleToken.attrSet('data-collapsible', marker === '+' ? 'open' : marker === '-' ? 'closed' : 'none')

  const bodyOpen = new state.Token('callout_body_open', 'div', 1)
  bodyOpen.block = true
  bodyOpen.attrSet('class', 'callout-body')

  const bodyClose = new state.Token('callout_body_close', 'div', -1)
  bodyClose.block = true

  const close = new state.Token('callout_close', 'div', -1)
  close.block = true

  state.tokens.push(open, titleToken, bodyOpen)
  if (nextLine - startLine > 1) {
    const saved: LineState[] = []
    // 临时把每行的 bMarks/tShift/sCount 挪到 `>` 之后,解析完立刻还原。
    // 必须四个数组一起改:block 规则取内容用的是 getLines()(走 bMarks/sCount),
    // 只改 tShift 的话正文会把 `>` 一起带出来。
    for (let line = startLine + 1; line < nextLine; line += 1) {
      const lineBegin = state.bMarks[line]! + state.tShift[line]!
      const lineEnd = state.eMarks[line]!
      if (lineBegin >= lineEnd || state.src.charCodeAt(lineBegin) !== 0x3e /* > */) continue
      saved.push({
        bMarks: state.bMarks[line]!,
        tShift: state.tShift[line]!,
        sCount: state.sCount[line]!,
        bsCount: state.bsCount[line]!,
      })
      let cursor = lineBegin + 1
      if (state.src.charCodeAt(cursor) === 0x20 || state.src.charCodeAt(cursor) === 0x09) cursor += 1
      while (cursor < lineEnd && isSpaceCode(state.src.charCodeAt(cursor))) cursor += 1
      const spaces = cursor - (lineBegin + 1)
      state.bMarks[line] = cursor
      state.tShift[line] = 0
      state.bsCount[line] = 0
      state.sCount[line] = spaces === 0 ? 0 : spaces - 1
    }
    state.md.block.tokenize(state, startLine + 1, nextLine)
    for (let i = 0; i < saved.length; i += 1) {
      const line = startLine + 1 + i
      state.bMarks[line] = saved[i]!.bMarks
      state.tShift[line] = saved[i]!.tShift
      state.sCount[line] = saved[i]!.sCount
      state.bsCount[line] = saved[i]!.bsCount
    }
  }
  state.tokens.push(bodyClose, close)
  state.line = nextLine
  return true
}

/** 备份一行原始状态(还原用) */
interface LineState {
  bMarks: number
  tShift: number
  sCount: number
  bsCount: number
}

// ---------------------------------------------------------------------------
// 任务列表
// ---------------------------------------------------------------------------

/** 匹配列表项开头的 checkbox 标记 */
const TASK_MARKER_RE = /^\[([ xX])\][ \t]+/

/**
 * 把 `- [ ] 待办` / `- [x] 完成` 渲染成禁用的 checkbox,
 * 并给列表加 contains-task-list / task-list-item 类方便样式。
 */
function transformTaskLists(tokens: Token[], TokenCtor: typeof TokenClass): void {
  // 记录每个列表层级的任务项数量
  const stack: number[] = []
  // 记录列表开启 token 的下标
  const openIndexes: number[] = []

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!
    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      stack.push(0)
      openIndexes.push(i)
      continue
    }
    if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') {
      const count = stack.pop() ?? 0
      const openIdx = openIndexes.pop() ?? -1
      if (count > 0 && openIdx !== -1) {
        const openToken = tokens[openIdx]!
        const cls = openToken.type === 'ordered_list_open' ? 'task-list' : 'contains-task-list'
        const existing = openToken.attrGet('class')
        openToken.attrSet('class', existing === null ? cls : existing + ' ' + cls)
      }
      continue
    }
    if (token.type !== 'inline') continue

    // 仅处理直接位于列表项里的段落(结构:list_item_open / paragraph_open / inline)
    const paragraphOpen = tokens[i - 1]
    const itemOpen = tokens[i - 2]
    if (paragraphOpen === undefined || paragraphOpen.type !== 'paragraph_open') continue
    if (itemOpen === undefined || itemOpen.type !== 'list_item_open') continue
    if (token.children === null) continue

    const first = token.children[0]
    if (first === undefined || first.type !== 'text') continue
    const match = TASK_MARKER_RE.exec(first.content)
    if (match === null) continue

    const checked = (match[1] ?? ' ').toLowerCase() === 'x'
    const itemClass = itemOpen.attrGet('class')
    itemOpen.attrSet('class', itemClass === null ? 'task-list-item' : itemClass + ' task-list-item')

    first.content = first.content.slice(match[0].length)
    if (first.content === '') token.children.shift()

    const checkbox = new TokenCtor('html_inline', '', 0)
    checkbox.content =
      '<input class="task-list-item-checkbox" type="checkbox" disabled' + (checked ? ' checked' : '') + '> '
    token.children.unshift(checkbox)

    if (stack.length > 0) stack[stack.length - 1] = (stack[stack.length - 1] ?? 0) + 1
  }
}

// ---------------------------------------------------------------------------
// 标题与大纲
// ---------------------------------------------------------------------------

/**
 * 收集 h1~h6:写入唯一 id,并产出大纲。
 * id 直接用标题 slug(而不是 heading-{序号}-slug),这样仓库里手写的
 * `[文字](#某标题)` 锚点才能命中;重复标题按 GitHub 的做法追加 -1 / -2 去重。
 */
function collectHeadings(tokens: Token[], outline: OutlineItem[]): void {
  let seq = 0
  const used = new Map<string, number>()
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!
    if (token.type !== 'heading_open') continue

    const inline = tokens[i + 1]
    const text = inline !== undefined && inline.type === 'inline' ? plainTextOf(inline.content) : ''

    seq += 1
    const base = slugify(text) || 'heading-' + seq
    const seen = used.get(base)
    let id = base
    if (seen !== undefined) {
      const next = seen + 1
      used.set(base, next)
      id = base + '-' + next
    } else {
      used.set(base, 0)
    }
    token.attrSet('id', id)

    const level = Number.parseInt(token.tag.slice(1), 10)
    outline.push({ level: Number.isNaN(level) ? 1 : level, text, id })
  }
}

// ---------------------------------------------------------------------------
// 渲染期:代码 / 链接 / 图片 / wikilink / 嵌入
// ---------------------------------------------------------------------------

/** 代码高亮:交给 src/utils/highlight.ts 那唯一一份按需注册的 highlight.js 实例 */
function highlightCode(code: string, langRaw: string): { html: string; lang: string } {
  return highlightBlock(code, langRaw) ?? { html: '', lang: 'text' }
}

/** 代码块结构:<div class="code-block"><span class="code-lang">…</span><pre><code class="hljs language-…">… */
function buildCodeBlock(token: Token, defaultLang: string): string {
  const info = unescapeHtml(token.info.trim().split(/\s+/)[0] ?? '')

  // mermaid 代码块不走高亮,而是产出一个占位容器,交给 MarkdownView 在挂载后
  // 用 mermaid 渲染成 SVG(渲染器是几 MB 的包,只能动态加载)。
  // 源码保留在 <pre class="mermaid-source"> 里:渲染失败时它就是可读的退化内容,
  // 切换主题重新渲染时也不必回到 Markdown 原文再解析一遍。
  if (info.toLowerCase() === 'mermaid') {
    return (
      '<div class="mermaid-block">' +
      '<pre class="mermaid-source">' + escapeHtml(token.content) + '</pre>' +
      '</div>\n'
    )
  }

  const { html, lang } = highlightCode(token.content, info)
  const plain = html === ''
  const badge = plain ? (defaultLang === '' ? 'text' : defaultLang) : lang
  const body = plain ? escapeHtml(token.content) : html
  return (
    '<div class="code-block">' +
    '<span class="code-lang">' + escapeHtml(badge) + '</span>' +
    '<pre><code class="hljs language-' + escapeHtml(badge) + '">' + body + '</code></pre>' +
    '</div>\n'
  )
}

/** 链接分类渲染 */
function renderLinkOpen(ctx: RenderContext | null, token: Token): string {
  const rawHref = token.attrGet('href')
  // markdown-it 已把 href 归一化成 percent 编码,先解回可读路径
  const href = typeof rawHref === 'string' ? decodePercent(rawHref.trim()) : ''
  const rawTitle = token.attrGet('title')
  const titleAttr = typeof rawTitle === 'string' && rawTitle !== '' ? ' title="' + escapeHtml(rawTitle) + '"' : ''

  if (href === '') return '<a' + titleAttr + '>'

  // 纯锚点
  if (href.startsWith('#')) return '<a href="' + escapeHtml(href) + '"' + titleAttr + '>'

  // 外链(协议 / 协议相对 / data / blob)
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href) && !/^\/api\/docs\//i.test(href)) {
    return (
      '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer"' + titleAttr + '>'
    )
  }

  // 仓库内资源:只拿路径部分去解析,查询串 / 锚点原样保留
  const hashIdx = href.indexOf('#')
  const beforeHash = hashIdx === -1 ? href : href.slice(0, hashIdx)
  const suffix = hashIdx === -1 ? '' : href.slice(hashIdx)
  const queryIdx = beforeHash.indexOf('?')
  const pathOnly = queryIdx === -1 ? beforeHash : beforeHash.slice(0, queryIdx)

  if (ctx !== null && pathOnly !== '') {
    const resolved = resolveResourcePath(ctx, pathOnly)
    if (resolved !== null) {
      // 仓库内已存在的文件 -> 内部跳转
      if (ctx.knownPaths.has(resolved)) {
        return (
          '<a class="doc-link" href="' + escapeHtml(docHref(resolved, suffix)) +
          '" data-doc-path="' + escapeHtml(resolved) + '"' + titleAttr + '>'
        )
      }
      // 其余仓库内资源交给 Worker 代理
      return (
        '<a href="' + escapeHtml(rawUrl(resolved)) + '" target="_blank" rel="noopener noreferrer"' +
        titleAttr + '>'
      )
    }
  }

  return '<a href="' + escapeHtml(href) + '"' + titleAttr + '>'
}

/** 图片渲染:仓库内资源走 Worker 代理,外链保持原样 */
function renderImage(ctx: RenderContext | null, token: Token): string {
  const rawSrc = token.attrGet('src')
  const src = typeof rawSrc === 'string' ? decodePercent(rawSrc.trim()) : ''
  const alt = token.content === '' ? '' : token.content
  let finalSrc = src
  if (ctx !== null && src !== '' && !EXTERNAL_RE.test(src)) {
    const resolved = resolveResourcePath(ctx, src)
    if (resolved !== null) finalSrc = rawUrl(resolved)
  }
  return '<img src="' + escapeHtml(finalSrc) + '" alt="' + escapeHtml(alt) + '" loading="lazy">'
}

/** [[目标|文字]] 渲染 */
function renderWikilink(ctx: RenderContext, body: string): string {
  const { targetRaw, headingRaw, display } = parseWikilinkBody(body)

  if (targetRaw === '') {
    return brokenLink(targetRaw, display)
  }

  const resolved = resolveTarget(ctx, targetRaw)
  if (resolved === null) return brokenLink(targetRaw, display)

  const anchor = headingRaw === '' ? '' : '#' + encodeURIComponent(headingRaw)
  return (
    '<a class="doc-link" href="' + escapeHtml(docHref(resolved, anchor)) +
    '" data-doc-path="' + escapeHtml(resolved) + '">' + escapeHtml(display) + '</a>'
  )
}

/** ![[嵌入]] 渲染:图片出 <img>,md 出占位块 */
function renderEmbed(ctx: RenderContext, body: string): string {
  const { targetRaw, headingRaw, display } = parseWikilinkBody(body)
  if (targetRaw === '') return brokenLink(targetRaw, display)

  const resolved = resolveTarget(ctx, targetRaw)
  const alt = display === '' ? baseName(targetRaw) : display

  if (IMAGE_EXT_RE.test(targetRaw)) {
    const path = resolved ?? resolveResourcePath(ctx, targetRaw) ?? normalizePath(targetRaw)
    return (
      '<img src="' + escapeHtml(rawUrl(path)) + '" alt="' + escapeHtml(alt) + '" loading="lazy">'
    )
  }

  if (resolved !== null && /\.(?:md|markdown)$/i.test(resolved)) {
    const suffix = headingRaw === '' ? '' : ' › ' + headingRaw
    return (
      '<div class="embed-placeholder" data-doc-path="' + escapeHtml(resolved) + '">嵌入文档:' +
      escapeHtml(resolved + suffix) + '</div>'
    )
  }

  if (resolved !== null) {
    return (
      '<div class="embed-placeholder" data-doc-path="' + escapeHtml(resolved) + '">嵌入文件:' +
      escapeHtml(resolved) + '</div>'
    )
  }

  return brokenLink(targetRaw, alt)
}

/** 解析 wikilink 的 目标 / 小节 / 显示文字 */
function parseWikilinkBody(body: string): {
  targetRaw: string
  headingRaw: string
  display: string
} {
  const pipeIdx = body.indexOf('|')
  const left = (pipeIdx === -1 ? body : body.slice(0, pipeIdx)).trim()
  const alias = pipeIdx === -1 ? '' : body.slice(pipeIdx + 1).trim()
  const hashIdx = left.indexOf('#')
  const targetRaw = (hashIdx === -1 ? left : left.slice(0, hashIdx)).trim()
  const headingRaw = hashIdx === -1 ? '' : left.slice(hashIdx + 1).trim()

  let display = targetRaw
  if (alias !== '') display = alias
  else if (headingRaw !== '') display = left
  else display = targetRaw

  return { targetRaw, headingRaw, display }
}

/** 未解析成功的 wikilink / 嵌入 */
function brokenLink(target: string, display: string): string {
  return (
    '<span class="doc-link-broken" title="未找到:' + escapeHtml(target) + '">' +
    escapeHtml(display) + '</span>'
  )
}

// ---------------------------------------------------------------------------
// frontmatter
// ---------------------------------------------------------------------------

/** 剥离开头的 frontmatter,返回正文与解析出的键值对 */
function splitFrontmatter(source: string): { body: string; meta: Record<string, string> | null } {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  if (!/^---[ \t]*\n/.test(normalized)) return { body: source, meta: null }

  const lines = normalized.split('\n')
  let endIdx = -1
  for (let i = 1; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trim()
    if (line === '---' || line === '...') {
      endIdx = i
      break
    }
  }
  if (endIdx === -1) return { body: source, meta: null }

  const meta: Record<string, string> = {}
  for (let i = 1; i < endIdx; i += 1) {
    const line = lines[i] ?? ''
    const trimmed = line.trim()
    // 跳过空行、注释、缩进的嵌套结构(只做扁平的 key: value 解析)
    if (trimmed === '' || trimmed.startsWith('#') || /^\s/.test(line)) continue
    const sep = line.indexOf(':')
    if (sep <= 0) continue
    const key = line.slice(0, sep).trim()
    let value = line.slice(sep + 1).trim()
    if (key === '') continue
    // 去掉首尾引号
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1)
    }
    meta[key] = value
  }

  return {
    body: lines.slice(endIdx + 1).join('\n'),
    meta: Object.keys(meta).length > 0 ? meta : null,
  }
}

// ---------------------------------------------------------------------------
// markdown-it 实例
// ---------------------------------------------------------------------------

/** 构造 md 实例(模块级单例,渲染上下文通过 env 传递,不引入跨次渲染的状态) */
function createMarkdownIt(): MarkdownItInstance {
  const md = new MarkdownIt({
    html: true, // 允许内联 HTML,最终由 DOMPurify 兜底
    linkify: true,
    breaks: false,
    typographer: false,
  })

  // 解析规则:数学公式 / Obsidian 语法
  md.block.ruler.before('fence', 'math_block', mathBlockRule, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  })
  md.inline.ruler.before('escape', 'math_inline', mathInlineRule)
  md.inline.ruler.before('link', 'obsidian_wikilink', wikilinkRule)
  md.inline.ruler.before('emphasis', 'obsidian_mark', markRule)
  md.inline.ruler.before('text', 'obsidian_emoji', emojiRule)
  // callout 必须抢在 blockquote 之前,才能接管 `> [!x]`
  md.block.ruler.before('blockquote', 'obsidian_callout', calloutRule, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  })

  // core 规则:数学 token 落地 -> 标题 id / 大纲 -> 任务列表
  md.core.ruler.push('obsidian_math', (state: StateCore) => {
    transformMathTokens(state.tokens)
  })
  md.core.ruler.push('obsidian_headings', (state: StateCore) => {
    const ctx = ctxOf(state.env)
    if (ctx !== null) collectHeadings(state.tokens, ctx.outline)
  })
  md.core.ruler.push('obsidian_tasks', (state: StateCore) => {
    transformTaskLists(state.tokens, state.Token)
  })

  // 代码块
  md.renderer.rules.fence = (tokens, idx): string => {
    const token = tokens[idx]
    if (token === undefined) return ''
    return buildCodeBlock(token, '')
  }

  // 图片
  md.renderer.rules.image = (tokens, idx, _options, env): string => {
    const token = tokens[idx]
    if (token === undefined) return ''
    return renderImage(ctxOf(env), token)
  }

  // 链接
  md.renderer.rules.link_open = (tokens, idx, _options, env): string => {
    const token = tokens[idx]
    if (token === undefined) return ''
    return renderLinkOpen(ctxOf(env), token)
  }

  // 标题:让默认 renderer 输出 core 阶段写入的 id
  md.renderer.rules.heading_open = (tokens, idx, options, _env, self): string =>
    self.renderToken(tokens, idx, options)

  // wikilink / 嵌入
  md.renderer.rules.obsidian_embed = (tokens, idx, _options, env): string => {
    const token = tokens[idx]
    if (token === undefined) return ''
    const ctx = ctxOf(env)
    if (ctx === null) return escapeHtml(token.content)
    return token.markup === '![['
      ? renderEmbed(ctx, token.content)
      : renderWikilink(ctx, token.content)
  }

  // callout:折叠状态由 data-collapsible 推导,渲染时把 is-collapsed 写到最外层
  md.renderer.rules.callout_open = (tokens, idx, options, _env, self): string => {
    const token = tokens[idx]
    if (token === undefined) return ''
    if (token.attrGet('data-collapsible') === 'closed') {
      const cls = token.attrGet('class')
      token.attrSet('class', (typeof cls === 'string' ? cls : 'callout') + ' is-collapsed')
    }
    return self.renderToken(tokens, idx, options)
  }

  // callout 标题:纯文本 + 转义(标题里的 markdown 不解析,避免和 `[!type]` 记号打架)
  // 折叠记号不写进文字,而是交给 data-collapsible 推导折叠状态
  md.renderer.rules.callout_title = (tokens, idx): string => {
    const token = tokens[idx]
    if (token === undefined) return ''
    const state = token.attrGet('data-collapsible')
    const fold = state === 'open' ? ' data-fold="open"' : state === 'closed' ? ' data-fold="closed"' : ''
    return '<div class="callout-title"' + fold + '>' + escapeHtml(token.content) + '</div>\n'
  }

  return md
}

/** 把 math_inline / math_block 换成 KaTeX 渲染结果 */
function transformMathTokens(tokens: Token[]): void {
  for (const token of tokens) {
    if (token.type === 'math_block') {
      token.type = 'html_block'
      token.tag = ''
      token.nesting = 0
      token.content = renderTex(token.content, true)
      token.children = null
      continue
    }
    if (token.children === null) continue
    for (const child of token.children) {
      if (child.type === 'math_inline') {
        child.type = 'html_inline'
        child.tag = ''
        child.nesting = 0
        child.content = renderTex(child.content, false)
        child.children = null
      }
    }
    transformMathTokens(token.children)
  }
}

/** 从 env 取渲染上下文 */
function ctxOf(env: unknown): RenderContext | null {
  if (env === null || typeof env !== 'object') return null
  const value = (env as Record<string, unknown>)[ENV_CTX_KEY]
  return value === undefined ? null : (value as RenderContext)
}

let mdSingleton: MarkdownItInstance | null = null

/** 取模块级 md 实例(懒加载,避免模块出现在非浏览器环境时立刻报错) */
function getMarkdownIt(): MarkdownItInstance {
  if (mdSingleton === null) mdSingleton = createMarkdownIt()
  return mdSingleton
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 渲染 Markdown 文档。
 *
 * @param source 原始 Markdown 文本
 * @param opts   当前文档路径 + 仓库内已知路径集合
 * @returns 消毒后的 HTML、大纲与 frontmatter
 */
export function renderMarkdown(source: string, opts: RenderOptions): RenderedDoc {
  const md = getMarkdownIt()
  const ctx = createContext(opts)
  const { body, meta } = splitFrontmatter(source)
  const env = makeEnv(ctx)
  const raw = md.render(body, env)
  return { html: sanitize(raw), outline: ctx.outline, meta }
}
