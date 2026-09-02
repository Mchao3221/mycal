import { useCallback, useEffect, useState } from 'react'
import type { Todo, TodoStore } from '../types'

const STORAGE_KEY = 'mycal:todos:v1'

function load(): TodoStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const data = JSON.parse(raw) as TodoStore
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

/** 待办状态 + localStorage 持久化 */
export function useTodos() {
  const [store, setStore] = useState<TodoStore>(load)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
    } catch {
      // 隐私模式等场景写入失败时静默降级
    }
  }, [store])

  const getDay = useCallback(
    (key: string): Todo[] => store[key] ?? [],
    [store],
  )

  const addTodo = useCallback((key: string, text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setStore(s => ({
      ...s,
      [key]: [
        ...(s[key] ?? []),
        { id: crypto.randomUUID(), text: trimmed, done: false, createdAt: Date.now() },
      ],
    }))
  }, [])

  const toggleTodo = useCallback((key: string, id: string) => {
    setStore(s => ({
      ...s,
      [key]: (s[key] ?? []).map(t => (t.id === id ? { ...t, done: !t.done } : t)),
    }))
  }, [])

  const removeTodo = useCallback((key: string, id: string) => {
    setStore(s => {
      const rest = (s[key] ?? []).filter(t => t.id !== id)
      const next = { ...s }
      if (rest.length) next[key] = rest
      else delete next[key]
      return next
    })
  }, [])

  return { store, getDay, addTodo, toggleTodo, removeTodo }
}
