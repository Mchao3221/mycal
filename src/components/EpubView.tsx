// EPUB 在线阅读组件(只读)
//
// 用 epubjs 把 .epub 渲染成一个可翻页的阅读器:
//  - 分页排版(paginated)+ 上一页/下一页 + 键盘左右箭头
//  - 进度百分比、当前章节名
//  - 书籍自带 TOC 从右侧滑出,支持多级嵌套
//  - 跟随 daisyUI 主题(data-theme)给书页注册浅色/深色皮肤,并提供字号三档
//  - 加载中骨架、加载失败中文提示;卸载/换书时彻底销毁 rendition 与 book
//
// 设计约束:组件本身不监听窗口尺寸,只接收父组件传入的 width / height
// (父组件尺寸变化时传新值,这里转成 rendition.resize),这样在固定高度的
// 容器里翻页不会撑破布局。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ePub from 'epubjs'
import type { Book, Contents, NavItem, Rendition } from 'epubjs'

export interface EpubViewProps {
  /** 电子书的同源 URL,例如 /api/docs/raw?path=07%2F...%2F01.epub */
  src: string
  /** 书名,用于顶部显示 */
  title: string
  /** 阅读区宽度变化时用来触发重排(不需要自己监听窗口,父组件会传新值) */
  width: number
  /** 阅读区高度,同上 */
  height: number
}

/** 组件内部主题键(daisyUI 主题名只用于判断深浅,实际注册的是这两套固定配色) */
const LIGHT_KEY = 'light'
const DARK_KEY = 'dark'

/** 书页配色:浅色 #ffffff 底 + #1f2328 字;深色 #1d232a 底 + #d7dbe0 字 */
const READER_THEMES: Record<string, { background: string; color: string; link: string; selection: string }> = {
  [LIGHT_KEY]: { background: '#ffffff', color: '#1f2328', link: '#1f6feb', selection: '#cfe2ff' },
  [DARK_KEY]: { background: '#1d232a', color: '#d7dbe0', link: '#7cb0ff', selection: '#2c4a70' },
}

/** 字号三档(daisyUI 主题里正文默认约 16px) */
const FONT_SIZES = [14, 16, 18] as const
const DEFAULT_FONT_SIZE = 16

/** 顶层目录可能只有一个「正文」之类的空壳,优先用它下面的一级条目做标题 */
const GENERIC_TOC_LABELS = new Set(['', '目录', '目次', 'contents', 'table of contents', 'toc', 'nav', 'navigation', '正文', 'start', 'beginning'])

type Status = 'loading' | 'ready' | 'error'

/** 取 href 的文件名部分(epubjs 的 href 带完整相对路径,可能带 #锚点) */
function baseName(href: string): string {
  const noHash = href.split('#')[0]
  const seg = noHash.split('/')
  return seg[seg.length - 1] ?? noHash
}

/** 读取当前 daisyUI 主题并判断深浅色,返回内部主题键 */
function currentThemeKey(): string {
  const theme = document.documentElement.dataset.theme ?? ''
  return /dark|dim|night|black|business|dracula|forest|halloween|luxury|synthwave|coffee|sunset|abyss|aqua/i.test(theme)
    ? DARK_KEY
    : LIGHT_KEY
}

/** 把嵌套的 NavItem 拍平(用于「当前章节名」的 href → 标题查找) */
function flattenToc(items: NavItem[], out: Array<{ href: string; label: string }> = []): Array<{ href: string; label: string }> {
  for (const item of items) {
    out.push({ href: item.href, label: item.label })
    if (item.subitems && item.subitems.length > 0) flattenToc(item.subitems, out)
  }
  return out
}

/** 从目录里挑一个适合当「章节名」的条目 */
function pickTocLabel(toc: NavItem[]): string | null {
  if (toc.length === 0) return null
  for (const item of toc) {
    if (!GENERIC_TOC_LABELS.has(item.label.trim().toLowerCase())) return item.label
  }
  const first = toc[0]
  if (first.subitems && first.subitems.length > 0) return first.subitems[0].label
  return first.label || null
}

/** 取当前已渲染的 contents:epubjs 的 d.ts 把 getContents() 写成单个 Contents(过窄),运行时实际是数组 */
function contentsOf(rendition: Rendition): Contents[] {
  return rendition.getContents() as unknown as Contents[]
}

/** 把任意异常转成能显示给用户的中文句子 */
function describeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  const text = raw.trim()
  if (!text) return '无法解析该文件,可能不是有效的 EPUB,或链接已失效。'
  return `无法解析该文件:${text.slice(0, 160)}`
}

export function EpubView({ src, title, width, height }: EpubViewProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const renditionRef = useRef<Rendition | null>(null)

  const [status, setStatus] = useState<Status>('loading')
  const [errorText, setErrorText] = useState('')
  const [toc, setToc] = useState<NavItem[]>([])
  const [chapter, setChapter] = useState<string | null>(null)
  const [chapterHref, setChapterHref] = useState<string | null>(null)
  const [percent, setPercent] = useState(0)
  const [fontSize, setFontSize] = useState<number>(DEFAULT_FONT_SIZE)
  const [tocOpen, setTocOpen] = useState(false)
  const [themeKey, setThemeKey] = useState<string>(() => currentThemeKey())

  // 主题序号:每次换肤都注册一个全新的主题名,见 applyReaderTheme 的说明
  const themeSeqRef = useRef(0)
  // 当前生效的配色 + 字号,paintReaderTheme 在每次渲染后要用
  const activeThemeRef = useRef({ key: LIGHT_KEY, size: DEFAULT_FONT_SIZE })

  /**
   * 把配色写进当前书页 iframe 的 body 内联样式(带 !important)。
   *
   * 为什么不能只靠 rendition.themes:
   *  1) 书自带样式里的 `body { background: #eee !important }` 会把我们注册的主题压掉
   *     (实测如此);内联 !important 在层叠里优先级最高,能稳定盖过书里的样式;
   *  2) epubjs 的 addStylesheetRules 是"只追加不替换",重复注入会让 <style> 里的规则无限堆积,
   *     所以这里不再往 <style> 塞规则,只写内联样式。
   * 字号走 epubjs 自己的覆盖通道(fontSize),它写的就是带 !important 的内联 font-size。
   */
  const paintReaderTheme = useCallback((): void => {
    const rendition = renditionRef.current
    if (!rendition) return
    const { key, size } = activeThemeRef.current
    const palette = READER_THEMES[key] ?? READER_THEMES[LIGHT_KEY]
    try {
      for (const content of contentsOf(rendition)) {
        const doc = content.document
        if (!doc || !doc.body) continue
        doc.body.style.setProperty('background-color', palette.background, 'important')
        doc.body.style.setProperty('color', palette.color, 'important')
      }
      // 字号在循环外统一走 epubjs 的覆盖通道(它写的就是带 !important 的内联 font-size)
      rendition.themes.fontSize(`${size}px`)
    } catch {
      /* 换肤失败不影响阅读,保留现有样式 */
    }
  }, [])

  /** 切换配色/字号:注册新主题名 → select → 覆盖字号 → 再补内联样式 */
  const applyReaderTheme = useCallback(
    (key: string, size: number): void => {
      activeThemeRef.current = { key, size }
      const rendition = renditionRef.current
      if (!rendition) return
      const palette = READER_THEMES[key] ?? READER_THEMES[LIGHT_KEY]
      const name = `mycal-reader-${key}-${++themeSeqRef.current}`
      try {
        rendition.themes.register(name, {
          body: [
            { background: palette.background, color: palette.color },
          ],
          'a, a:visited': { color: palette.link },
          '::selection': { background: palette.selection },
        })
        rendition.themes.select(name)
        // 字号必须跟着一起重新注入:单独调 fontSize() 对已经渲染好的 iframe 同样不重绘
        rendition.themes.fontSize(`${size}px`)
      } catch {
        /* 忽略 */
      }
      paintReaderTheme()
    },
    [paintReaderTheme],
  )

  // 初始渲染尺寸与字号放进 ref:创建 book/rendition 的主 effect 只依赖 src,
  // 避免尺寸或字号变化时把整本书重建一遍。尺寸/字号在各自的 effect 里处理。
  const sizeRef = useRef({ width, height })
  const fontSizeRef = useRef(fontSize)
  sizeRef.current = { width, height }
  fontSizeRef.current = fontSize

  // 目录里「章节文件名 → 章节名」,用于 relocated 事件里反查当前章节(顺带判断高亮哪一项)
  const tocLabelByFile = useMemo(() => {
    const map = new Map<string, string>()
    for (const { href, label } of flattenToc(toc)) {
      const key = baseName(href)
      if (!map.has(key)) map.set(key, label)
    }
    return map
  }, [toc])
  const tocIndexRef = useRef(tocLabelByFile)
  tocIndexRef.current = tocLabelByFile

  // ① 主 effect:建书 → 渲染 → 显示。依赖只有 src,卸载或换书时彻底销毁。
  //    React 18 严格模式会 mount → unmount → mount,靠 cleanup 把第一次的
  //    book/rendition 完整销毁(epubjs 的 destroy 会清掉自带 iframe),所以是幂等的。
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let book: Book | null = null
    let disposed = false

    setStatus('loading')
    setErrorText('')
    setToc([])
    setChapter(null)
    setChapterHref(null)
    setPercent(0)
    setTocOpen(false)

    try {
      book = ePub(src)
    } catch (err) {
      setStatus('error')
      setErrorText(describeError(err))
      return
    }

    // 首次渲染用的尺寸:props 优先,父容器还没量到时退到容器的实际尺寸,最后兜底一个常见开本
    const initial = sizeRef.current
    const w = initial.width > 0 ? Math.round(initial.width) : host.clientWidth > 0 ? host.clientWidth : 800
    const h = initial.height > 0 ? Math.round(initial.height) : host.clientHeight > 0 ? host.clientHeight : 600

    const run = async (): Promise<void> => {
      try {
        await book!.ready
        if (disposed) return

        // 目录(失败不影响阅读,只影响目录面板)
        try {
          const navigation = await book!.loaded.navigation
          if (!disposed) {
            setToc(navigation.toc)
            setChapter(pickTocLabel(navigation.toc))
          }
        } catch {
          /* 没有 nav/ncx 的畸形书:目录留空,正文照常可读 */
        }
        if (disposed) return

        const created = book!.renderTo(host, { width: w, height: h, flow: 'paginated' })
        renditionRef.current = created

        // 每次渲染新章节后都补一次内联配色,否则书自带的 !important 样式会在新 iframe 里生效
        created.on('rendered', paintReaderTheme)

        // 先应用一套配色,保证首屏就是正确底色
        applyReaderTheme(currentThemeKey(), fontSizeRef.current)

        created.on('relocated', (location: unknown) => {
          const loc = location as { start?: { href?: string; percentage?: number } } | null
          const start = loc?.start
          if (!start) return
          if (typeof start.percentage === 'number' && Number.isFinite(start.percentage)) {
            setPercent(Math.max(0, Math.min(100, Math.round(start.percentage * 100))))
          }
          if (typeof start.href === 'string') {
            const file = baseName(start.href)
            setChapter(tocIndexRef.current.get(file) ?? null)
            setChapterHref(file)
          }
        })

        await created.display()
        if (disposed) {
          created.destroy()
          return
        }
        setStatus('ready')
      } catch (err) {
        if (disposed) return
        setStatus('error')
        setErrorText(describeError(err))
      }
    }

    void run()

    return () => {
      disposed = true
      // 顺序:先销毁 rendition(连它的事件、钩子与 iframe),再销毁 book 的容器
      const active = renditionRef.current
      renditionRef.current = null
      if (active) {
        try {
          active.off('rendered', paintReaderTheme)
        } catch {
          /* 忽略 */
        }
        try {
          active.destroy()
        } catch {
          /* 已经销毁过,忽略 */
        }
      }
      if (book) {
        try {
          book.destroy()
        } catch {
          /* 同上 */
        }
      } else if (host) {
        // 连 book 都没建成(ePub() 直接抛)时,清掉可能残留的 DOM
        host.innerHTML = ''
      }
    }
    // tocIndex 只在 relocated 回调(闭包会随 state 更新重建)里用,不必因为它重建整本书;
    // applyReaderTheme / paintReaderTheme 都是空依赖的稳定回调,列进来不会引发重建。
  }, [src, applyReaderTheme, paintReaderTheme])

  // ② 尺寸变化 → rendition.resize(不重建 book)
  useEffect(() => {
    const r = renditionRef.current
    if (!r || status !== 'ready') return
    if (!(width > 0) || !(height > 0)) return
    try {
      r.resize(Math.round(width), Math.round(height))
    } catch {
      /* 重排失败不影响已有页面 */
    }
  }, [width, height, status])

  // ③ 主题与字号变化 → 重新注入书页。
  //    两者合并成一个 effect:字号也必须走 applyReaderTheme 的新主题名策略,
  //    单独调 rendition.themes.fontSize() 对已经渲染好的 iframe 不会重绘。
  const firstThemeRun = useRef(true)
  useEffect(() => {
    if (firstThemeRun.current) {
      // 首次由主 effect 在 display() 之前应用,这里跳过,避免重复注册
      firstThemeRun.current = false
      return
    }
    if (status !== 'ready') return
    applyReaderTheme(themeKey, fontSize)
  }, [themeKey, fontSize, status, applyReaderTheme])

  // ④ 跟随 daisyUI 主题切换(data-theme 变化时换肤)
  useEffect(() => {
    const root = document.documentElement
    const read = (): void => setThemeKey(currentThemeKey())
    const observer = new MutationObserver(read)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    read()
    return () => observer.disconnect()
  }, [])

  // 翻页:epubjs 在书首/书尾时 next()/prev() 会 reject,这里吞掉避免 unhandled rejection
  const goPrev = useCallback((): void => {
    const r = renditionRef.current
    if (!r) return
    void r.prev().catch(() => undefined)
  }, [])

  const goNext = useCallback((): void => {
    const r = renditionRef.current
    if (!r) return
    void r.next().catch(() => undefined)
  }, [])

  const goTo = useCallback((href: string): void => {
    const r = renditionRef.current
    setTocOpen(false)
    if (!r) return
    void r.display(href).catch(() => undefined)
  }, [])

  // 键盘左右箭头翻页(书页在 iframe 里,监听 window 依然能收到焦点事件)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        goPrev()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        goNext()
      } else if (event.key === 'Escape') {
        setTocOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [goPrev, goNext])

  const loading = status === 'loading'
  const failed = status === 'error'

  return (
    <div className="relative flex h-full flex-col bg-base-100 text-base-content">
      {/* 顶栏:书名 + 当前章节 + 进度 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-base-300 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold" title={title}>{title}</div>
          <div className="truncate text-xs opacity-60">
            {loading ? '正在加载电子书…' : chapter ? `当前章节:${chapter}` : '电子书'}
          </div>
        </div>
        <div className="shrink-0 text-xs tabular-nums opacity-70">{percent}%</div>
      </div>

      {/* 阅读区:flex-1 + min-h-0,固定高度里翻页不撑破父布局 */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div ref={hostRef} className="absolute inset-0" />

        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-base-100">
            <span className="loading loading-spinner loading-lg text-primary" aria-hidden="true" />
            <p className="text-sm opacity-70">正在加载电子书…</p>
            <div className="w-2/3 max-w-md space-y-2">
              <div className="skeleton h-4 w-full" />
              <div className="skeleton h-4 w-11/12" />
              <div className="skeleton h-4 w-4/5" />
            </div>
          </div>
        )}

        {failed && (
          <div className="absolute inset-0 flex items-center justify-center bg-base-100 p-6">
            <div className="max-w-md text-center">
              <p className="text-base font-semibold">电子书加载失败</p>
              <p className="mt-2 text-sm break-words opacity-70">{errorText}</p>
              <p className="mt-2 text-xs opacity-50">请确认文件链接可访问,且确实是有效的 EPUB 文件。</p>
            </div>
          </div>
        )}

        {/* 目录面板:从右侧滑出 */}
        <div
          className={`absolute inset-y-0 right-0 z-20 w-72 max-w-[85%] transform border-l border-base-300 bg-base-100 shadow-xl transition-transform duration-200 ease-out ${
            tocOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
          aria-hidden={!tocOpen}
        >
          <div className="flex items-center justify-between border-b border-base-300 px-3 py-2">
            <span className="text-sm font-semibold">目录</span>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setTocOpen(false)}>关闭</button>
          </div>
          <div className="h-[calc(100%-2.75rem)] overflow-y-auto px-2 py-2">
            <NavList items={toc} depth={0} activeHref={chapterHref} onSelect={goTo} />
            {toc.length === 0 && <p className="px-2 py-4 text-xs opacity-60">这本书没有提供目录</p>}
          </div>
        </div>

        {/* 目录打开时点遮罩关闭(遮罩在面板下面,不挡住面板操作) */}
        {tocOpen && (
          <button
            type="button"
            aria-label="关闭目录"
            className="absolute inset-0 z-10 cursor-default bg-black/20"
            onClick={() => setTocOpen(false)}
          />
        )}
      </div>

      {/* 底栏:翻页 + 字号 + 目录 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-base-300 px-3 py-2">
        <button type="button" className="btn btn-sm" onClick={goPrev} disabled={loading || failed}>上一页</button>
        <button type="button" className="btn btn-sm" onClick={goNext} disabled={loading || failed}>下一页</button>
        <div className="flex items-center gap-1 text-xs opacity-70">
          <span>字号</span>
          <div className="join">
            {FONT_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                className={`btn btn-xs join-item ${size === fontSize ? 'btn-active' : ''}`}
                aria-pressed={size === fontSize}
                onClick={() => setFontSize(size)}
              >
                {size}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1" />
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setTocOpen((v) => !v)} disabled={loading || failed}>
          目录
        </button>
      </div>
    </div>
  )
}

/** 递归渲染嵌套目录 */
function NavList({
  items,
  depth,
  activeHref,
  onSelect,
}: {
  items: NavItem[]
  depth: number
  activeHref: string | null
  onSelect: (href: string) => void
}): JSX.Element {
  return (
    <ul className={depth === 0 ? 'menu w-full gap-0.5 p-0' : 'menu w-full gap-0.5 p-0 pl-3'}>
      {items.map((item, index) => {
        const active = activeHref !== null && baseName(item.href) === activeHref
        return (
          <li key={`${item.id || item.href}-${index}`}>
            <button
              type="button"
              className={`block w-full truncate text-left text-xs ${active ? 'font-semibold text-primary' : ''}`}
              title={item.label}
              onClick={() => onSelect(item.href)}
            >
              {item.label || '(未命名)'}
            </button>
            {item.subitems && item.subitems.length > 0 && (
              <NavList items={item.subitems} depth={depth + 1} activeHref={activeHref} onSelect={onSelect} />
            )}
          </li>
        )
      })}
    </ul>
  )
}

export default EpubView
