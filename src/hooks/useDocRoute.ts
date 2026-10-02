import { useEffect, useState } from 'react'

/**
 * 当前文档的路由:?doc=<uri 编码后的仓库路径>。
 *
 * 为什么用查询串而不是 hash(#/doc/...):
 *   Markdown 里的标题锚点天生就是 hash(这个仓库的 README 自己就写了
 *   `[一、设计理念](#一设计理念)` 这种目录)。如果文档路由也占用 hash,
 *   点目录就会把路由冲掉,页面直接变回空状态。查询串和 hash 互不干扰,
 *   锚点跳转、浏览器前进后退、刷新恢复全部是浏览器原生行为。
 *
 * 用 pushState 而不是改 location.search:后者会触发整页刷新,SPA 没必要。
 * pushState 不会派发 popstate,所以额外维护一份订阅者名单主动通知。
 */
const PARAM = 'doc'

function readRoute(): string | null {
  try {
    const doc = new URLSearchParams(window.location.search).get(PARAM)
    return doc || null
  } catch {
    return null
  }
}

const listeners = new Set<() => void>()

export function useDocRoute(): string | null {
  const [path, setPath] = useState<string | null>(readRoute)

  useEffect(() => {
    const sync = () => setPath(readRoute())
    listeners.add(sync)
    window.addEventListener('popstate', sync)
    return () => {
      listeners.delete(sync)
      window.removeEventListener('popstate', sync)
    }
  }, [])

  return path
}

/** 打开某个文档 */
export function navigateToDoc(path: string): void {
  const url = new URL(window.location.href)
  url.searchParams.set(PARAM, path)
  // 换文件时必须清掉上一条文档留下的锚点,否则新文件会莫名其妙滚到同名的标题
  url.hash = ''
  if (url.href === window.location.href) return
  window.history.pushState(null, '', url)
  for (const notify of listeners) notify()
}
