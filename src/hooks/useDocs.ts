import { useCallback, useEffect, useState } from 'react'
import { api, fetchText } from '../utils/api'
import { isTextKind, rawUrl } from '../utils/fileKind'
import type { DocsTree } from '../types'

/**
 * 拉取仓库文件树。
 * 首次加载与手动刷新分开两个状态:手动刷新时保留旧树继续显示,
 * 否则每点一次刷新整棵目录树会闪一下白。
 */
export function useDocsTree() {
  const [tree, setTree] = useState<DocsTree | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (fresh: boolean) => {
    if (fresh) setRefreshing(true)
    else setLoading(true)
    setError('')
    try {
      const next = await api<DocsTree>(`/api/docs/tree${fresh ? '?refresh=1' : ''}`)
      setTree(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
  }, [load])

  return { tree, error, loading, refreshing, reload: load }
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

export function useDocContent(path: string | null): DocContent {
  const [state, setState] = useState<DocContent>({ status: 'idle' })

  useEffect(() => {
    if (!path || !isTextKind(path)) {
      setState({ status: 'idle' })
      return
    }
    let alive = true
    setState({ status: 'loading' })
    fetchText(rawUrl(path))
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
  }, [path])

  return state
}
