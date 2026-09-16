import { useCallback, useEffect, useState } from 'react'
import type { JournalEntry, JournalStore } from '../types'
import { api } from '../utils/api'

/** 当日流水(记录今天做了哪些事)状态,数据存 D1,经 REST API 读写 */
export function useJournal() {
  const [store, setStore] = useState<JournalStore>({})

  useEffect(() => {
    api<JournalStore>('/api/journal')
      .then(setStore)
      .catch(err => console.error('加载流水失败:', err))
  }, [])

  const reload = useCallback(async () => {
    setStore(await api<JournalStore>('/api/journal'))
  }, [])

  const getDay = useCallback(
    (key: string): JournalEntry[] => store[key] ?? [],
    [store],
  )

  const add = useCallback(async (key: string, text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const entry = await api<JournalEntry>('/api/journal', {
      method: 'POST',
      body: JSON.stringify({ dateKey: key, text: trimmed }),
    })
    setStore(s => ({ ...s, [key]: [...(s[key] ?? []), entry] }))
  }, [])

  const patch = useCallback(async (key: string, id: string, text: string) => {
    const entry = await api<JournalEntry>(`/api/journal/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ text }),
    })
    setStore(s => ({ ...s, [key]: (s[key] ?? []).map(e => (e.id === id ? entry : e)) }))
  }, [])

  const remove = useCallback(async (key: string, id: string) => {
    await api<{ ok: true }>(`/api/journal/${id}`, { method: 'DELETE' })
    setStore(s => {
      const rest = (s[key] ?? []).filter(e => e.id !== id)
      const next = { ...s }
      if (rest.length) next[key] = rest
      else delete next[key]
      return next
    })
  }, [])

  return { store, getDay, add, patch, remove, reload }
}
