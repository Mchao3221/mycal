import { useMemo } from 'react'
import { DayCell } from './DayCell'
import { WEEKDAYS, monthMatrix, todayKey, weekOfYear } from '../utils/date'
import type { DotMark } from '../types'

interface Props {
  year: number
  /** 0 起始月份 */
  month: number
  selectedKey: string
  /** 各日期标记(用于圆点着色) */
  marks: ReadonlyMap<string, DotMark[]>
  onPick: (key: string) => void
  onPrevMonth: () => void
  onNextMonth: () => void
  onToday: () => void
}

export function Calendar({
  year,
  month,
  selectedKey,
  marks,
  onPick,
  onPrevMonth,
  onNextMonth,
  onToday,
}: Props) {
  const cells = useMemo(() => monthMatrix(year, month), [year, month])
  const todayK = todayKey()

  const weekTag = useMemo(() => {
    const [y, m, d] = selectedKey.split('-').map(Number)
    return `第 ${weekOfYear(new Date(y, m - 1, d))} 周`
  }, [selectedKey])

  return (
    <section
      className="rounded-box border border-base-300 bg-base-100 p-6 pb-5 shadow-sm"
      aria-label="月历"
    >
      <header className="mb-4 flex items-center justify-between">
        <h2 className="m-0 font-display text-2xl font-semibold tracking-tight">
          {year} · {month + 1} 月
          <small className="mt-1 block font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-base-content/50">
            {weekTag}
          </small>
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-square text-lg"
            onClick={onPrevMonth}
            aria-label="上个月"
          >
            ‹
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-square text-lg"
            onClick={onNextMonth}
            aria-label="下个月"
          >
            ›
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onToday}>
            今天
          </button>
        </div>
      </header>

      <div className="grid grid-cols-7 gap-[5px]">
        {WEEKDAYS.map(w => (
          <span
            key={w}
            className="pb-2 text-center font-mono text-[11px] tracking-wide text-base-content/45"
          >
            {w}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-[5px]" role="grid">
        {cells.map(c => (
          <DayCell
            key={c.key}
            cell={c}
            isToday={c.key === todayK}
            isSelected={c.key === selectedKey}
            marks={marks.get(c.key) ?? []}
            onClick={() => onPick(c.key)}
          />
        ))}
      </div>

      <div className="mt-3.5 flex items-center gap-4 border-t border-base-300 pt-3.5 font-mono text-[11px] tracking-wide text-base-content/50">
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block size-[7px] rounded-full bg-primary" />
          日程
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block size-[7px] rounded-full bg-secondary" />
          待办
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block size-[7px] rounded-full bg-success" />
          打卡
        </span>
      </div>
    </section>
  )
}
