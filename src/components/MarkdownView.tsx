import { useEffect, useMemo, useRef, useState } from 'react'
import { renderMarkdown } from '../utils/markdown'
import { formatSize } from '../utils/fileKind'
import { hydrateMermaidBlocks, refitMermaidBlocks } from '../utils/mermaid'
import { navigateToDoc } from '../hooks/useDocRoute'

interface Props {
  /** 仓库内路径 */
  path: string
  text: string
  size: number
  /** 全部文件路径,交给渲染器解析 [[wikilink]] */
  knownPaths: Set<string>
}

/**
 * Markdown 阅读视图。
 * 正文是 renderMarkdown 产出的**已消毒** HTML,这里只负责容器、大纲与内部跳转拦截。
 */
export function MarkdownView({ path, text, size, knownPaths }: Props) {
  const doc = useMemo(() => renderMarkdown(text, { docPath: path, knownPaths }), [text, path, knownPaths])
  const bodyRef = useRef<HTMLDivElement>(null)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const name = path.split('/').pop() ?? path
  const dir = path.split('/').slice(0, -1).join('/')

  // 换文档时回到顶部,否则会停在上一个文件滚到的位置
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 })
    setOutlineOpen(false)
  }, [path])

  /**
   * 渲染 mermaid 图。
   * 依赖里带上 theme 是为了深浅色切换后重画:SVG 的颜色是渲染时烘进去的,
   * 不重画的话会在深色背景上留一张浅色图(反之亦然)。
   * mermaid 包本身是动态 import,所以不打开带图的文档就一个字节都不下载。
   */
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? 'mycal')
  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => setTheme(root.dataset.theme ?? 'mycal'))
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    // hydrate 会先同步抓取当前这批 .mermaid-block 再逐个 await 渲染,
    // 所以就算中途换了文档,晚到的结果也只会写进已经被 React 摘掉的旧节点,不会串图。
    void hydrateMermaidBlocks(body).catch(() => {
      /* 单块失败已在 hydrate 内部隔离处理,这里只兜住预期外的异常 */
    })
    // 窗口尺寸变化会改变可用宽高,只重算缩放(不重新渲染 SVG),代价很低
    const onResize = () => {
      if (bodyRef.current) refitMermaidBlocks(bodyRef.current)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [doc.html, theme])

  /**
   * 支持 Markdown 里原生的标题锚点(仓库 README 自己就有 `[一、设计理念](#一设计理念)` 这种目录)。
   * 必须等 doc.html 更新完再找目标:直接查很可能目标 DOM 还没生成。
   * 带锚点打开页面(?doc=X#某标题)时也靠这里滚过去,因为 pushState/首次渲染都不会自动滚动。
   */
  useEffect(() => {
    const raw = window.location.hash.slice(1)
    if (!raw) return
    let id = raw
    try {
      id = decodeURIComponent(raw)
    } catch {
      /* 非法转义就按原样找 */
    }
    const timer = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ block: 'start' })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [doc.html, path])

  /**
   * 内部链接拦截:渲染器给 wikilink 产出了 data-doc-path,
   * 在这里 preventDefault 后走 pushState,避免整页刷新。
   * 不拦 ctrl/cmd/中键点击 —— 那些是想开新标签页的正常诉求。
   */
  const onBodyClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const el = e.target as HTMLElement

    // ① 可折叠 callout:点标题展开/收起。
    //    渲染器给所有 callout 都写了 data-collapsible,普通 callout 的值是 "none",
    //    必须排除它,否则点普通 callout 的标题也会把正文收起来。
    const title = el.closest('.callout-title')
    if (title) {
      const callout = title.closest('.callout')
      const state = callout?.getAttribute('data-collapsible')
      if (state === 'open' || state === 'closed') {
        callout!.classList.toggle('is-collapsed')
        return
      }
    }

    // ② 内部文档跳转:渲染器给了 data-doc-path,这里走 pushState 避免整页刷新
    const anchor = el.closest('a.doc-link')
    if (!anchor) return
    const target = anchor.getAttribute('data-doc-path')
    if (!target) return
    e.preventDefault()
    navigateToDoc(target)
  }

  const jumpTo = (id: string) => {
    // 用 scrollIntoView 而不是改 hash:hash 要留给 Markdown 自带的标题锚点,
    // 文档路由走的是查询串,两者不能互相冲掉。
    const el = bodyRef.current?.querySelector(`#${CSS.escape(id)}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setOutlineOpen(false)
  }

  const metaEntries = doc.meta ? Object.entries(doc.meta) : []

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-base-300 px-4 py-1.5 text-xs text-base-content/50">
        <span className="truncate" title={dir}>
          {dir || '仓库根目录'}
        </span>
        <span className="ml-auto shrink-0">{formatSize(size)}</span>
        {doc.outline.length > 0 && (
          <div className="relative shrink-0">
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => setOutlineOpen(v => !v)}
              aria-expanded={outlineOpen}
            >
              大纲 {doc.outline.length}
            </button>
            {outlineOpen && (
              <>
                {/* 点空白处收起 */}
                <div className="fixed inset-0 z-10" onClick={() => setOutlineOpen(false)} />
                <ul className="panel-scroll absolute right-0 z-20 mt-1 max-h-[60vh] w-72 overflow-auto rounded-box border border-base-300 bg-base-100 p-2 shadow-lg">
                  {doc.outline.map((item, i) => (
                    <li key={`${item.id}-${i}`}>
                      <button
                        type="button"
                        className="w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-base-200"
                        style={{ paddingLeft: `${(item.level - 1) * 12 + 8}px` }}
                        title={item.text}
                        onClick={() => jumpTo(item.id)}
                      >
                        {item.text}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        <a className="btn btn-ghost btn-xs shrink-0" href={`/api/docs/raw?path=${encodeURIComponent(path)}`} target="_blank" rel="noopener noreferrer">
          源码
        </a>
      </div>

      <div ref={bodyRef} className="panel-scroll min-h-0 flex-1 overflow-auto" onClick={onBodyClick}>
        <article className="md-body mx-auto max-w-3xl px-6 py-6">
          {metaEntries.length > 0 && (
            <div className="mb-6 rounded-box border border-base-300 bg-base-200/60 px-4 py-3 text-xs">
              {metaEntries.map(([key, value]) => (
                <div key={key} className="flex gap-2 py-0.5">
                  <span className="shrink-0 font-medium text-base-content/60">{key}</span>
                  <span className="break-all text-base-content/80">{value}</span>
                </div>
              ))}
            </div>
          )}
          <h1 className="md-title">{name.replace(/\.md$/i, '')}</h1>
          {/* 内容已由 renderMarkdown 内做 DOMPurify 消毒 */}
          <div dangerouslySetInnerHTML={{ __html: doc.html }} />
        </article>
      </div>
    </div>
  )
}
