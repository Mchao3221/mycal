import { useCallback, useEffect, useMemo, useState } from 'react'
import { DocTree } from './components/DocTree'
import { LockScreen } from './components/LockScreen'
import { ReaderPane } from './components/ReaderPane'
import { useDocContent, useDocsTree } from './hooks/useDocs'
import { navigateToDoc, useDocRoute } from './hooks/useDocRoute'
import { useSidebarWidth } from './hooks/useSidebarWidth'
import { api } from './utils/api'
import { ancestorsOf, baseNameOf, buildTree, collectDirPaths } from './utils/tree'
import { loadJson, loadString, saveJson, saveString } from './utils/storage'
import type { LockStatus } from './types'

type LockPhase = 'checking' | 'setup' | 'locked' | 'ready'

export default function App() {
  const [phase, setPhase] = useState<LockPhase>('checking')

  useEffect(() => {
    let alive = true
    api<LockStatus>('/api/lock/status')
      .then(status => {
        if (!alive) return
        setPhase(!status.isSet ? 'setup' : status.unlocked ? 'ready' : 'locked')
      })
      .catch(() => {
        // 查不到锁状态时按「已上锁」处理:宁可让用户多输一次访问码,也不能把内容漏出去
        if (alive) setPhase('locked')
      })
    return () => {
      alive = false
    }
  }, [])

  if (phase === 'checking') {
    return (
      <div className="grid min-h-dvh place-items-center bg-base-200">
        <span className="loading loading-spinner loading-md text-primary" />
      </div>
    )
  }

  if (phase !== 'ready') return <LockScreen mode={phase} onUnlocked={() => setPhase('ready')} />

  return <Workspace onLocked={() => setPhase('locked')} />
}

/** 解锁后的工作台:左目录 + 右阅读区,两栏各自内部滚动,整页不出滚动条 */
function Workspace({ onLocked }: { onLocked: () => void }) {
  const { tree, error, loading, refreshing, reload } = useDocsTree()
  const { width, onDragStart } = useSidebarWidth()
  const routePath = useDocRoute()

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(loadJson<string[]>('expandedDirs', [])))
  const [recent, setRecent] = useState<string[]>(() => loadJson<string[]>('recent', []))
  const [theme, setTheme] = useState(() => loadString('theme', 'mycal'))

  const root = useMemo(() => (tree ? buildTree(tree.files) : null), [tree])
  const knownPaths = useMemo(() => new Set(tree?.files.map(f => f.path) ?? []), [tree])
  const sizeOf = useMemo(() => new Map(tree?.files.map(f => [f.path, f.size]) ?? []), [tree])
  const allDirs = useMemo(() => (root ? collectDirPaths(root) : []), [root])

  // 当前文件必须是真实存在的路径:手工改地址栏、或文件在仓库里被删掉之后,
  // 不能让阅读区拿着一个不存在的路径去请求
  const currentPath = routePath && knownPaths.has(routePath) ? routePath : null
  const content = useDocContent(currentPath)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    saveString('theme', theme)
  }, [theme])

  useEffect(() => {
    saveJson('expandedDirs', [...expanded])
  }, [expanded])

  useEffect(() => {
    saveJson('recent', recent)
  }, [recent])

  // 打开一个深层文件时,自动把它沿途的父目录展开,否则左侧根本看不到当前文件在哪
  useEffect(() => {
    if (!currentPath) return
    setExpanded(prev => {
      const next = new Set(prev)
      for (const dir of ancestorsOf(currentPath)) next.add(dir)
      return next.size === prev.size ? prev : next
    })
    setRecent(prev => [currentPath, ...prev.filter(p => p !== currentPath)].slice(0, 15))
  }, [currentPath])

  const toggleDir = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const lockNow = async () => {
    try {
      await api<{ ok: true }>('/api/lock/lock', { method: 'POST' })
    } catch {
      // 即使请求失败也回锁屏:本地状态先收紧,避免「点了上锁其实没锁上」的错觉
    }
    onLocked()
  }

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
          <h1 className="mb-1 mt-0 text-base font-semibold">无法读取仓库目录</h1>
          <p className="mb-4 mt-0 text-sm text-base-content/70">
            内容来自 Gitee 私有仓库,失败通常是令牌缺失或失效,也可能是网络不通。
          </p>
          <pre className="panel-scroll mb-4 max-h-40 overflow-auto whitespace-pre-wrap rounded-box bg-base-200 p-3 text-xs text-error">
            {error || '未知错误'}
          </pre>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void reload(true)}>
              重试
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void lockNow()}>
              上锁
            </button>
          </div>
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

        <span
          className="hidden truncate text-xs text-base-content/45 sm:inline"
          title={`${tree.owner}/${tree.repo}@${tree.branch}`}
        >
          {tree.owner}/{tree.repo}
          <span className="mx-1 text-base-content/25">·</span>
          {tree.branch}
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
          {tree.truncated && <span className="badge badge-warning badge-sm">目录被截断</span>}
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => void reload(true)}
            disabled={refreshing}
            title="重新拉取仓库目录"
          >
            {refreshing ? <span className="loading loading-spinner loading-xs" /> : '刷新'}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => setTheme(theme === 'dim' ? 'mycal' : 'dim')}
            title="切换深浅色"
          >
            {theme === 'dim' ? '浅色' : '深色'}
          </button>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => void lockNow()}>
            上锁
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
            />
          </div>

          {recent.length > 0 && (
            <div className="panel-scroll max-h-36 shrink-0 overflow-auto border-t border-base-300 px-2 py-1.5">
              <div className="pl-1 text-[11px] text-base-content/45">最近阅读</div>
              <ul className="mt-0.5 flex flex-col gap-px">
                {recent.slice(0, 8).map(path => (
                  <li key={path}>
                    <button
                      type="button"
                      className={`w-full truncate rounded-md px-2 py-[3px] text-left text-[12px] transition-colors ${
                        path === currentPath ? 'bg-primary/10 text-primary' : 'text-base-content/70 hover:bg-base-200'
                      }`}
                      title={path}
                      onClick={() => navigateToDoc(path)}
                    >
                      {baseNameOf(path)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
            content={content}
            knownPaths={knownPaths}
          />
        </main>
      </div>
    </div>
  )
}
