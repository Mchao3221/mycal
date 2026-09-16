import { useCallback, useEffect, useState } from 'react'
import type { WeightEntry, WeightStore } from '../types'
import { api } from '../utils/api'

/** 体重记录状态:一天一条,同日再录即覆盖 */
export function useWeights() {
  const [store, setStore] = useState<WeightStore>({})

  useEffect(() => {
    api<WeightStore>('/api/weights')
      .then(setStore)
      .catch(err => console.error('加载体重记录失败:', err))
  }, [])

  const reload = useCallback(async () => {
    setStore(await api<WeightStore>('/api/weights'))
  }, [])

  const get = useCallback(
    (key: string): WeightEntry | null => store[key] ?? null,
    [store],
  )

  /** 按日期 upsert(支持补录任意日期) */
  const setFor = useCallback(async (key: string, weightKg: number) => {
    const entry = await api<WeightEntry>('/api/weights', {
      method: 'POST',
      body: JSON.stringify({ dateKey: key, weightKg }),
    })
    setStore(s => ({ ...s, [key]: entry }))
    return entry
  }, [])

  const remove = useCallback(async (key: string) => {
    await api<{ ok: true }>(`/api/weights/${key}`, { method: 'DELETE' })
    setStore(s => {
      const next = { ...s }
      delete next[key]
      return next
    })
  }, [])

  return { store, get, setFor, remove, reload }
}
