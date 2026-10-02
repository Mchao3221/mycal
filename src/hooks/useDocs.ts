import { useCallback, useEffect, useState } from 'react'
import { api, fetchText } from '../utils/api'
import { isTextKind, rawUrl } from '../utils/fileKind'
import type { DocsTree } from '../types'

/**
 * 拉取文件清单。
 * v0.6.0 起这份数据直接来自 D1 里的同步副本,不再实时回源 Gitee ——
 * 所以它是快的、稳的,「刷新」按钮的语义也从「绕过缓存重拉」变成了「同步仓库」。
 */
export function useDocsTree() {
  const [tree, setTree] = useState<DocsTree | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setError('')
    try {
      setTree(await api<DocsTree>('/api/docs/tree'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { tree, error, loading, reload }
}

/**
 * 文本类文件的正文(不需要正文的类型保持 idle,由各自的组件直接用 URL 当资源)。
 * 用 res.text() 取:后端可能按 charset=gb18030 下发老 SQL,浏览器会自动按该编码解码。
 */
export type DocContent =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; text: string }

export function useDocContent(path: string | null, sha?: string): DocContent {
  const [state, setState] = useState<DocContent>({ status: 'idle' })

  useEffect(() => {
    if (!path || !isTextKind(path)) {
      setState({ status: 'idle' })
      return
    }
    let alive = true
    setState({ status: 'loading' })
    fetchText(rawUrl(path, sha))
      .then(text => {
        if (alive) setState({ status: 'ready', text })
      })
      .catch((err: unknown) => {
        if (alive) setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      })
    return () => {
      // 快速连点目录时,晚到的响应不能覆盖新文件的内容
      alive = false
    }
  }, [path, sha])

  return state
}
