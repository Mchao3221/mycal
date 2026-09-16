import { useEffect, useState } from 'react'
import { todayKey } from '../utils/date'
import type { WeightEntry } from '../types'

interface Props {
  dateKey: string
  entry: WeightEntry | null
  /** 截至当日的近 7 日均值(无数据为 null) */
  avg7: number | null
  onSave: (kg: number) => Promise<void>
  onClear: () => Promise<void>
  notify: (kind: 'success' | 'error', text: string) => void
}

/** 今日体重一行式录入:同日再录即覆盖;口径建议晨起空腹 */
export function WeightToday({ dateKey, entry, avg7, onSave, onClear, notify }: Props) {
  const [draft, setDraft] = useState(entry ? String(entry.weightKg) : '')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setDraft(entry ? String(entry.weightKg) : '')
  }, [dateKey, entry])

  const submit = async () => {
    if (busy) return
    const n = Math.round(Number(draft) * 10) / 10
    if (!Number.isFinite(n) || n < 20 || n > 400) {
      notify('error', '体重需为 20~400 kg 的数字')
      return
    }
    setBusy(true)
    try {
      await onSave(n)
    } catch (err) {
      notify('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const delta =
    entry && avg7 != null ? Math.round((entry.weightKg - avg7) * 10) / 10 : null

  // 跟随日历所选日期:选今天显示"今日",选别天显示具体日期(补录同一路径)
  const [, cm, cd] = dateKey.split('-')
  const label = dateKey === todayKey() ? '⚖️ 今日体重' : `⚖️ ${Number(cm)} 月 ${Number(cd)} 日体重`

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="m-0 font-mono text-[11px] uppercase tracking-[0.08em] text-base-content/45">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <div className="join">
          <input
            className="input input-bordered input-sm w-24 join-item text-right tabular-nums"
            value={draft}
            inputMode="decimal"
            placeholder="0.0"
            aria-label="体重(kg)"
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void submit()
              }
            }}
          />
          <span className="join-item grid h-8 w-10 place-items-center border border-base-300 bg-base-200 font-mono text-xs text-base-content/50">
            kg
          </span>
        </div>
        <button type="button" className="btn btn-sm" disabled={!draft.trim() || busy} onClick={() => void submit()}>
          {entry ? '更新' : '保存'}
        </button>
        {entry && (
          <button
            type="button"
            className="btn btn-ghost btn-sm text-base-content/40 hover:text-secondary"
            onClick={() => void onClear().catch(err => notify('error', String(err)))}
            title="清除当天记录"
          >
            ✕
          </button>
        )}
      </div>
      <span className="font-mono text-xs text-base-content/50">
        {entry ? (
          delta != null && `较7日均 ${delta > 0 ? '+' : ''}${delta.toFixed(1)} kg`
        ) : (
          '晨起空腹一称,一天一条'
        )}
      </span>
    </div>
  )
}
