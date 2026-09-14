import { useCallback, useEffect, useState } from 'react'
import type { HealthLog, HealthLogInput, HealthStore } from '../types'
import { api } from '../utils/api'

/** 打卡日记(饮食/运动)状态,数据存本地 SQLite,经 REST API 读写 */
export function useHealth() {
  const [store, setStore] = useState<HealthStore>({})

  useEffect(() => {
    api<HealthStore>('/api/health')
      .then(setStore)
      .catch(err => console.error('加载打卡记录失败:', err))
  }, [])

  const reload = useCallback(async () => {
    setStore(await api<HealthStore>('/api/health'))
  }, [])

  const getDay = useCallback(
    (key: string): HealthLog[] => store[key] ?? [],
    [store],
  )

  const addLog = useCallback(async (key: string, input: HealthLogInput) => {
    const log = await api<HealthLog>('/api/health', {
      method: 'POST',
      body: JSON.stringify({ dateKey: key, ...input }),
    })
    setStore(s => ({ ...s, [key]: [...(s[key] ?? []), log] }))
  }, [])

  /** 局部修改(手动修正热量/文字/餐次);onSuccess 便于调用方带异常提示 */
  const patchLog = useCallback(
    async (key: string, id: string, patch: Partial<HealthLogInput>) => {
      const log = await api<HealthLog>(`/api/health/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      setStore(s => ({
        ...s,
        [key]: (s[key] ?? []).map(l => (l.id === id ? log : l)),
      }))
    },
    [],
  )

  const removeLog = useCallback(async (key: string, id: string) => {
    await api<{ ok: true }>(`/api/health/${id}`, { method: 'DELETE' })
    setStore(s => {
      const rest = (s[key] ?? []).filter(l => l.id !== id)
      const next = { ...s }
      if (rest.length) next[key] = rest
      else delete next[key]
      return next
    })
  }, [])

  return { store, getDay, addLog, patchLog, removeLog, reload }
}
