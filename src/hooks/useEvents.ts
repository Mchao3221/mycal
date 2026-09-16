import { useCallback, useEffect, useState } from 'react'
import type { Todo, TodoStore } from '../types'
import { api } from '../utils/api'

/**
 * ICS 日程状态(v0.4 起 todos 表只承载日程,手动待办已退役)。
 * 全量拉取后按日期本地分发;仅需删除(清理误导入)与导入后 reload。
 */
export function useEvents() {
  const [store, setStore] = useState<TodoStore>({})

  useEffect(() => {
    api<TodoStore>('/api/todos')
      .then(setStore)
      .catch(err => console.error('加载日程失败:', err))
  }, [])

  const reload = useCallback(async () => {
    setStore(await api<TodoStore>('/api/todos'))
  }, [])

  const getDay = useCallback(
    (key: string): Todo[] => store[key]?.filter(t => t.source === 'ics') ?? [],
    [store],
  )

  const removeEvent = useCallback(async (key: string, id: string) => {
    await api<{ ok: true }>(`/api/todos/${id}`, { method: 'DELETE' })
    setStore(s => {
      const rest = (s[key] ?? []).filter(t => t.id !== id)
      const next = { ...s }
      if (rest.length) next[key] = rest
      else delete next[key]
      return next
    })
  }, [])

  return { store, getDay, removeEvent, reload }
}
