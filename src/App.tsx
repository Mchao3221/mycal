import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DocTree } from './components/DocTree'
import { LockScreen } from './components/LockScreen'
import { ReaderPane } from './components/ReaderPane'
import { useDocContent, useDocsTree } from './hooks/useDocs'
import { navigateToDoc, useDocRoute } from './hooks/useDocRoute'
import { useSidebarWidth } from './hooks/useSidebarWidth'
import { api } from './utils/api'
import { isTextKind, rawUrl } from './utils/fileKind'
import { ancestorsOf, buildTree, collectDirPaths } from './utils/tree'
import { loadJson, loadString, saveJson, saveString } from './utils/storage'
import type { LockStatus } from './types'

type LockPhase = 'checking' | 'setup' | 'locked' | 'ready'

/** 同步时间的口语化显示:刚同步完就写「刚刚」,比一串时间戳有用 */
function formatSyncTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  return new Date(ts).toLocaleDateString()
}

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
   *
   * 打开文件慢的根因在 Cloudflare 到 Gitee 那一段,但"感知速度"可以在前端补:
   * 鼠标停在某个文件上就先把内容取回来塞进浏览器缓存(响应头是 private, max-age=300),
   * 真正点开时通常就是零请求。150ms 防抖,避免鼠标扫过目录树时打出一串请求。
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
          <h1 className="mb-1 mt-0 text-base font-semibold">无法读取本地目录清单</h1>
          <p className="mb-4 mt-0 text-sm text-base-content/70">
            清单来自同步进 D1 的副本;读不到通常是本地数据库异常,而不是 Gitee 的问题。
          </p>
          <pre className="panel-scroll mb-4 max-h-40 overflow-auto whitespace-pre-wrap rounded-box bg-base-200 p-3 text-xs text-error">
            {error || '未知错误'}
          </pre>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void reload()}>
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

  // 还没同步过:此时读任何文件都会 409,不如直接把「怎么同步」摆在面前
  if (tree.syncedAt === 0 && tree.files.length === 0) {
    return (
      <div className="grid min-h-dvh place-items-center bg-base-200 p-6">
        <div className="w-full max-w-lg rounded-box border border-base-300 bg-base-100 p-6">
          <h1 className="mb-2 mt-0 text-base font-semibold">仓库尚未同步</h1>
          <p className="mb-1 mt-0 text-sm text-base-content/70">
            这个阅读器不实时访问 Gitee,而是先把仓库同步进 Cloudflare D1,之后只读本地副本 ——
            这样打开文件不再受链路快慢影响。
          </p>
          <p className="mb-4 mt-0 text-sm text-base-content/70">
            同步在<b>你自己的电脑上</b>跑(Cloudflare 到 gitee.com 的网络不通,浏览器又会被
            Gitee 的风控拦下,只有本机命令行能正常取数)。在项目目录执行:
          </p>
          <pre className="panel-scroll mb-4 overflow-auto rounded-box bg-base-200 p-3 text-left font-mono text-xs">
            pnpm run sync
          </pre>
          <p className="mb-4 mt-0 text-xs text-base-content/45">
            {tree.owner}/{tree.repo}@{tree.branch} · 首次约 800 个文件、预计一两分钟;
            之后再跑只会传有变化的文件。
          </p>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void reload()}>
            已完成同步,重新加载
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
          {tree.syncedAt > 0 && (
            <>
              <span className="mx-1 text-base-content/25">·</span>
              <span title={new Date(tree.syncedAt).toLocaleString()}>同步于 {formatSyncTime(tree.syncedAt)}</span>
            </>
          )}
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => void reload()}
            title="重新读取本地清单(同步请在本机执行 pnpm run sync)"
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
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => void lockNow()}>
            上锁
          </button>
        </div>
      </header>

      {/* 半截数据的告警。
          线上曾出现「从没完成过一次同步(收尾没跑),但已经传了 52 个文件」的状态:
          文件数不为 0,于是所有"未同步"的判断都失效,页面看起来完全正常,
          用户只看到两个顶层目录、还以为是目录树坏了。
          只要 syncedAt 还是 0 就说明这份数据不完整,必须显式说出来。 */}
      {tree.syncedAt === 0 && tree.files.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-warning/40 bg-warning/15 px-3 py-1.5 text-xs text-base-content/80">
          <span className="font-semibold text-warning">数据不完整</span>
          <span className="min-w-0 truncate">
            这份内容来自一次没有跑完的同步,当前只有 {tree.files.length} 个文件。在本机项目目录执行
            <code className="mx-1 rounded bg-base-100/70 px-1 py-0.5 font-mono">pnpm run sync</code>
            补全后再刷新本页。
          </span>
        </div>
      )}

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
