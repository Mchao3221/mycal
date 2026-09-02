import { useCallback, useEffect, useState } from 'react'
import type { Todo, TodoStore } from '../types'

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

/** 待办/日程状态,数据存本地 SQLite,经 REST API 读写 */
export function useTodos() {
  const [store, setStore] = useState<TodoStore>({})

  useEffect(() => {
    api<TodoStore>('/api/todos')
      .then(setStore)
      .catch(err => console.error('加载待办失败:', err))
  }, [])

  const reload = useCallback(async () => {
    setStore(await api<TodoStore>('/api/todos'))
  }, [])

  const getDay = useCallback(
    (key: string): Todo[] => store[key] ?? [],
    [store],
  )

  const addTodo = useCallback(async (key: string, text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const todo = await api<Todo>('/api/todos', {
      method: 'POST',
      body: JSON.stringify({ dateKey: key, text: trimmed }),
    })
    setStore(s => ({ ...s, [key]: [...(s[key] ?? []), todo] }))
  }, [])

  const toggleTodo = useCallback(async (key: string, id: string) => {
    const todo = await api<Todo>(`/api/todos/${id}/toggle`, { method: 'POST' })
    setStore(s => ({
      ...s,
      [key]: (s[key] ?? []).map(t => (t.id === id ? todo : t)),
    }))
  }, [])

  const removeTodo = useCallback(async (key: string, id: string) => {
    await api<void>(`/api/todos/${id}`, { method: 'DELETE' })
    setStore(s => {
      const rest = (s[key] ?? []).filter(t => t.id !== id)
      const next = { ...s }
      if (rest.length) next[key] = rest
      else delete next[key]
      return next
    })
  }, [])

  return { store, getDay, addTodo, toggleTodo, removeTodo, reload }
}
