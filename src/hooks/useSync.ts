import { useCallback, useRef, useState } from 'react'
import { api } from '../utils/api'
import type { SyncApplyResult, SyncPlan } from '../types'

/** 单批文件数。Worker 侧硬上限是 8,这里保持一致 */
const SYNC_BATCH = 8

export type SyncPhase = 'idle' | 'planning' | 'fetching' | 'finishing' | 'done' | 'error'

export interface SyncProgress {
  phase: SyncPhase
  /** 已处理 / 需处理 的文件数 */
  done: number
  total: number
  /** 内容没变、无需重新拉取的文件数 */
  unchanged: number
  failed: { path: string; error: string }[]
  message: string
}

const IDLE: SyncProgress = { phase: 'idle', done: 0, total: 0, unchanged: 0, failed: [], message: '' }

/**
 * 驱动一次完整的仓库同步。
 *
 * 为什么拆成「plan → files(多批)→ finish」而不是一个请求:
 *   1. 一个 Worker 请求的时间与 CPU 都有上限,789 个文件 + 2.4MB 的 epub 一次做完会超;
 *   2. 拆开之后能显示进度,中断了再点一次刷新就是续传(内容寻址,重复拉取不会重复写);
 *   3. 每一步都无状态,前端只是把循环驱动起来。
 */
export function useSync(onFinished: () => void) {
  const [progress, setProgress] = useState<SyncProgress>(IDLE)
  const [running, setRunning] = useState(false)
  const runningRef = useRef(false)

  const start = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    setRunning(true)
    setProgress({ ...IDLE, phase: 'planning', message: '正在对比仓库差异…' })

    try {
      const plan = await api<SyncPlan>('/api/sync/plan', { method: 'POST' })
      setProgress({
        phase: plan.need.length > 0 ? 'fetching' : 'finishing',
        done: 0,
        total: plan.need.length,
        unchanged: plan.unchanged,
        failed: [],
        message:
          plan.need.length === 0
            ? `内容无变化(${plan.unchanged} 个文件),只做清理`
            : `需要同步 ${plan.need.length} 个文件(未变 ${plan.unchanged} 个)`,
      })

      const failed: { path: string; error: string }[] = []
      let saved = 0
      let done = 0

      for (let i = 0; i < plan.need.length; i += SYNC_BATCH) {
        const batch = plan.need.slice(i, i + SYNC_BATCH)
        const res = await api<SyncApplyResult>('/api/sync/files', {
          method: 'POST',
          body: JSON.stringify({ items: batch.map(f => ({ path: f.path, sha: f.sha })) }),
        })
        saved += res.saved
        if (res.failed.length > 0) failed.push(...res.failed)
        // 整批都失败通常意味着链路不通,别再徒劳地跑剩下的批
        if (res.saved === 0 && res.failed.length === batch.length) {
          throw new Error(`同步中断:${res.failed[0]?.error ?? '上游不可用'}${res.diag ? `\n上游记录 → ${res.diag}` : ''}`)
        }
        done = Math.min(i + batch.length, plan.need.length)
        setProgress({
          phase: 'fetching',
          done,
          total: plan.need.length,
          unchanged: plan.unchanged,
          failed: [...failed],
          message: `已同步 ${done}/${plan.need.length}`,
        })
      }

      setProgress(p => ({ ...p, phase: 'finishing', message: '正在清理已删除的文件…' }))
      await api('/api/sync/finish', {
        method: 'POST',
        body: JSON.stringify({ paths: plan.paths, rev: plan.rev }),
      })

      setProgress({
        phase: 'done',
        done,
        total: plan.need.length,
        unchanged: plan.unchanged,
        failed,
        message:
          failed.length > 0
            ? `同步完成:入库 ${saved} 个,失败 ${failed.length} 个`
            : `同步完成:入库 ${saved} 个文件${plan.removed > 0 ? `,清理 ${plan.removed} 个已删除` : ''}`,
      })
      onFinished()
    } catch (err) {
      setProgress(p => ({
        ...p,
        phase: 'error',
        message: err instanceof Error ? err.message : String(err),
      }))
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }, [onFinished])

  const reset = useCallback(() => setProgress(IDLE), [])

  return { progress, running, start, reset }
}
