import { useCallback, useEffect, useState } from 'react'
import type { AiSummary } from '../types'
import { api } from '../utils/api'
import { todayKey } from '../utils/date'

interface Props {
  dateKey: string
  notify: (kind: 'success' | 'error', text: string) => void
  /** 汇总生成后回调(用于刷新条目上 AI 估算的热量) */
  onGenerated?: () => void
}

/**
 * AI 每日汇总面板(右栏独立区):收支四数字 + 结构化长评。
 * 生成时服务端顺带回填缺失热量(不覆盖手动值);按天缓存,可清除重生成。
 */
export function AiSummaryPanel({ dateKey, notify, onGenerated }: Props) {
  const [summary, setSummary] = useState<AiSummary | null>(null)
  const [generating, setGenerating] = useState(false)

  // 切日期:拉当天已缓存的汇总
  useEffect(() => {
    let on = true
    setSummary(null)
    api<AiSummary | null>(`/api/ai/summary/${dateKey}`)
      .then(s => on && setSummary(s))
      .catch(err => console.error('加载 AI 汇总失败:', err))
    return () => {
      on = false
    }
  }, [dateKey])

  const generate = useCallback(async () => {
    if (generating) return
    setGenerating(true)
    try {
      const s = await api<AiSummary>('/api/ai/summary', {
        method: 'POST',
        body: JSON.stringify({ dateKey }),
      })
      setSummary(s)
      onGenerated?.()
      notify(
        'success',
        s.pendingCount
          ? `汇总完成 · ${s.pendingCount} 条未能估算热量,可手动补填`
          : '今日 AI 汇总已生成',
      )
    } catch (err) {
      notify('error', err instanceof Error ? err.message : String(err))
    } finally {
      setGenerating(false)
    }
  }, [dateKey, generating, notify, onGenerated])

  const clearSummary = useCallback(async () => {
    try {
      await api<{ ok: true }>(`/api/ai/summary/${dateKey}`, { method: 'DELETE' })
      setSummary(null)
    } catch (err) {
      notify('error', err instanceof Error ? err.message : String(err))
    }
  }, [dateKey, notify])

  const netNegative = (summary?.netKcal ?? 0) <= 0

  return (
    <div className="flex flex-col">
      <h3 className="m-0 mb-3 font-mono text-[11px] uppercase tracking-[0.08em] text-base-content/45">
        ✨ AI 每日汇总
      </h3>

      {generating ? (
        <div className="flex items-center gap-3 py-6 text-sm text-base-content/60">
          <span className="loading loading-spinner loading-sm" />
          AI 正在估算热量并结合档案、流水与体重写点评…
        </div>
      ) : summary ? (
        <div>
          {/* 收支四数字:竖排两列在窄栏里比横排更稳 */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-3">
            <div className="rounded-lg bg-base-200/60 px-3 py-2">
              <div className="font-mono text-[10px] text-base-content/45">摄入</div>
              <div className="font-display text-lg font-semibold tabular-nums text-warning">
                {summary.intakeKcal}
                <small className="ml-0.5 text-[10px] font-normal text-base-content/45">kcal</small>
              </div>
            </div>
            <div className="rounded-lg bg-base-200/60 px-3 py-2">
              <div className="font-mono text-[10px] text-base-content/45">总消耗</div>
              <div className="font-display text-lg font-semibold tabular-nums text-accent">
                {summary.burnKcal}
                <small className="ml-0.5 text-[10px] font-normal text-base-content/45">kcal</small>
              </div>
            </div>
            <div className="rounded-lg bg-base-200/60 px-3 py-2">
              <div className="font-mono text-[10px] text-base-content/45">
                净差 · {netNegative ? '亏空' : '盈余'} ≈ {(summary.weightDeltaKg * 7).toFixed(2)} kg/周
              </div>
              <div
                className={`font-display text-lg font-semibold tabular-nums ${
                  netNegative ? 'text-success' : 'text-error'
                }`}
              >
                {summary.netKcal > 0 ? '+' : ''}
                {summary.netKcal}
                <small className="ml-0.5 text-[10px] font-normal text-base-content/45">kcal</small>
              </div>
            </div>
            <div className="rounded-lg bg-base-200/60 px-3 py-2">
              <div className="font-mono text-[10px] text-base-content/45">建议摄入</div>
              <div className="font-display text-lg font-semibold tabular-nums">
                {summary.targetKcal}
                <small className="ml-0.5 text-[10px] font-normal text-base-content/45">kcal</small>
              </div>
            </div>
          </div>
          <div className="mt-1.5 font-mono text-[10px] text-base-content/40">
            BMR {summary.bmr} · TDEE {summary.tdee} · 运动 {summary.exerciseKcal}
            {summary.weightKg != null && ` · 体重 ${summary.weightKg} kg`}
          </div>

          {summary.pendingCount > 0 && (
            <p className="mb-0 mt-3 font-mono text-xs text-warning">
              ⚠ {summary.pendingCount} 条未能估算热量,已按 0 计,可点击条目手动补填后重新生成
            </p>
          )}

          <p className="mb-0 mt-3 text-sm leading-relaxed whitespace-pre-line">{summary.comment}</p>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-base-300 pt-2.5">
            <span className="mr-auto font-mono text-[11px] text-base-content/40">
              {summary.model} ·{' '}
              {new Date(summary.generatedAt).toLocaleString('zh-CN', {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
              {dateKey === todayKey() ? '' : ' · 历史日'}
            </span>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => void clearSummary()}>
              清除
            </button>
            <button type="button" className="btn btn-outline btn-xs" onClick={() => void generate()}>
              重新生成
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-sm leading-relaxed text-base-content/55">
            记完这一天后点这里:AI 会补齐未填的热量,并结合你的档案(基础代谢/日常消耗)、当日流水与体重,写一份分段的今日点评与明日建议。
          </p>
          <button type="button" className="btn btn-accent" onClick={() => void generate()}>
            ✨ 生成今日汇总
          </button>
        </div>
      )}
    </div>
  )
}
