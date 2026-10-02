import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DocTree } from './components/DocTree'
import { ReaderPane } from './components/ReaderPane'
import { useDocContent, useDocsTree } from './hooks/useDocs'
import { navigateToDoc, useDocRoute } from './hooks/useDocRoute'
import { useSidebarWidth } from './hooks/useSidebarWidth'
import { isTextKind, rawUrl } from './utils/fileKind'
import { ancestorsOf, buildTree, collectDirPaths } from './utils/tree'
import { loadJson, loadString, saveJson, saveString } from './utils/storage'

/**
 * MyDocs —— 本地只读文档阅读器(v0.7.0)。
 *
 * 文档内容由开发服务器**直接从本机目录读取**(见 `tools/docs-server.mjs`):
 * 没有云端、没有上传、没有同步、没有访问码,`pnpm run dev` 打开即读。
 *
 * 之所以退回到这一步:部署在 Cloudflare 的网页跑在 Cloudflare 的机器上,
 * 它永远看不到你本机的磁盘;要让线上能读就必须先把内容上传(旧方案),
 * 而那条路上 Cloudflare 到 Gitee 不通、浏览器被 Gitee 风控拦、本机连续请求又被限流,
 * 取数环节怎么做都不可靠。既然只需要在本机读,那就根本不需要取数 —— 直接读文件。
 */
export default function App() {
  return <Workspace />
}

/** 工作台:左目录 + 右阅读区,两栏各自内部滚动,整页不出滚动条 */
function Workspace() {
  const { tree, error, loading, reload } = useDocsTree()
  const { width, onDragStart } = useSidebarWidth()
  const routePath = useDocRoute()

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(loadJson<string[]>('expandedDirs', [])))
  const [theme, setTheme] = useState(() => loadString('theme', 'mycal'))

  const root = useMemo(() => (tree ? buildTree(tree.files) : null), [tree])
  const knownPaths = useMemo(() => new Set(tree?.files.map(f => f.path) ?? []), [tree])
  const sizeOf = useMemo(() => new Map(tree?.files.map(f => [f.path, f.size]) ?? []), [tree])
  // 路径 → blob sha。前端本来就已经握有整棵树,把它捎给 worker 就能省掉
  // 「为了把路径换成 sha 而重新拉一遍文件树」这两个上游请求。
  const shaOf = useMemo(() => new Map(tree?.files.map(f => [f.path, f.sha]) ?? []), [tree])
  const allDirs = useMemo(() => (root ? collectDirPaths(root) : []), [root])

  // 当前文件必须是真实存在的路径:手工改地址栏、或文件在仓库里被删掉之后,
  // 不能让阅读区拿着一个不存在的路径去请求
  const currentPath = routePath && knownPaths.has(routePath) ? routePath : null
  const currentSha = currentPath ? shaOf.get(currentPath) : undefined
  const content = useDocContent(currentPath, currentSha)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    saveString('theme', theme)
  }, [theme])

  useEffect(() => {
    saveJson('expandedDirs', [...expanded])
  }, [expanded])

  // 打开一个深层文件时,自动把它沿途的父目录展开,否则左侧根本看不到当前文件在哪
  useEffect(() => {
    if (!currentPath) return
    setExpanded(prev => {
      const next = new Set(prev)
      for (const dir of ancestorsOf(currentPath)) next.add(dir)
      return next.size === prev.size ? prev : next
    })
  }, [currentPath])

  const toggleDir = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  /**
   * 悬停预热。
   * 鼠标停在某个文件上就先把内容取回来(本地读盘 + 浏览器缓存),真正点开时通常就是零请求。
   * 150ms 防抖,避免鼠标扫过目录树时打出一串请求。
   */
  const prefetchTimer = useRef<number | null>(null)
  const prefetch = useCallback(
    (target: string) => {
      if (!isTextKind(target)) return
      if (prefetchTimer.current !== null) window.clearTimeout(prefetchTimer.current)
      prefetchTimer.current = window.setTimeout(() => {
        const url = rawUrl(target, shaOf.get(target))
        // 必须把 body 读掉,否则浏览器可能中断下载,缓存里什么都没有
        void fetch(url)
          .then(res => res.text())
          .catch(() => undefined)
      }, 150)
    },
    [shaOf],
  )
  useEffect(
    () => () => {
      if (prefetchTimer.current !== null) window.clearTimeout(prefetchTimer.current)
    },
    [],
  )

  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-base-200">
        <span className="inline-flex items-center gap-2 text-sm text-base-content/60">
          <span className="loading loading-spinner loading-sm" />
          正在读取仓库目录…
        </span>
      </div>
    )
  }

  if (error || !tree || !root) {
    return (
      <div className="grid min-h-dvh place-items-center bg-base-200 p-6">
        <div className="w-full max-w-lg rounded-box border border-error/40 bg-base-100 p-6">
          <h1 className="mb-1 mt-0 text-base font-semibold">读不到文档目录</h1>
          <p className="mb-4 mt-0 text-sm text-base-content/70">
            内容由开发服务器直接读本机目录。请检查 <code className="font-mono">.env</code> 里的
            <code className="mx-1 font-mono">DOCS_DIR</code> 是否指向一个存在的目录,然后重启
            <code className="mx-1 font-mono">pnpm run dev</code>。
          </p>
          <pre className="panel-scroll mb-4 max-h-40 overflow-auto whitespace-pre-wrap rounded-box bg-base-200 p-3 text-xs text-error">
            {error || '未知错误'}
          </pre>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void reload()}>
            重试
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-base-100">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-base-300 px-3">
        <div className="flex shrink-0 items-center gap-2">
          <span className="btn btn-primary btn-square btn-xs font-mono text-[10px] font-bold">D</span>
          <span className="font-display text-sm font-semibold tracking-tight">MyDocs</span>
        </div>

        <span className="hidden min-w-0 truncate text-xs text-base-content/45 sm:inline" title={tree.dir}>
          <span className="font-mono">{tree.dir}</span>
          {tree.rev && (
            <>
              <span className="mx-1 text-base-content/25">·</span>
              <span className="font-mono">{tree.rev.slice(0, 7)}</span>
            </>
          )}
          <span className="mx-1 text-base-content/25">·</span>
          {tree.files.length} 个文件
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => void reload()}
            title="重新扫描文档目录(改了文件不用重启)"
          >
            重新加载
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => setTheme(theme === 'dim' ? 'mycal' : 'dim')}
            title="切换深浅色"
          >
            {theme === 'dim' ? '浅色' : '深色'}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside style={{ width: `${width}px` }} className="flex min-h-0 shrink-0 flex-col border-r border-base-300">
          <div className="flex shrink-0 items-center gap-1 px-2 py-1.5 text-[11px] text-base-content/45">
            <span className="pl-1">目录</span>
            <span className="ml-auto tabular-nums text-base-content/30">{allDirs.length} 个文件夹</span>
            <button
              type="button"
              className="btn btn-ghost btn-xs px-1"
              title="全部展开"
              onClick={() => setExpanded(new Set(allDirs))}
            >
              展开
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs px-1"
              title="全部折叠"
              onClick={() => setExpanded(new Set())}
            >
              折叠
            </button>
          </div>

          <div className="panel-scroll min-h-0 flex-1 overflow-auto px-2">
            <DocTree
              root={root}
              currentPath={currentPath}
              expanded={expanded}
              onToggle={toggleDir}
              onSelect={navigateToDoc}
              onHover={prefetch}
            />
          </div>
        </aside>

        <div
          onMouseDown={onDragStart}
          className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-primary/30"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整目录栏宽度"
        />

        <main className="min-w-0 flex-1">
          <ReaderPane
            path={currentPath}
            size={currentPath ? (sizeOf.get(currentPath) ?? 0) : 0}
            sha={currentSha}
            content={content}
            knownPaths={knownPaths}
          />
        </main>
      </div>
    </div>
  )
}
