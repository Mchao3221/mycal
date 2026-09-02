import { useMemo } from 'react'
import { DayCell } from './DayCell'
import { WEEKDAYS, monthMatrix, todayKey } from '../utils/date'

interface Props {
  year: number
  /** 0 起始月份 */
  month: number
  selectedKey: string
  todoDates: ReadonlySet<string>
  onPick: (key: string) => void
  onPrevMonth: () => void
  onNextMonth: () => void
  onToday: () => void
}

export function Calendar({
  year,
  month,
  selectedKey,
  todoDates,
  onPick,
  onPrevMonth,
  onNextMonth,
  onToday,
}: Props) {
  const cells = useMemo(() => monthMatrix(year, month), [year, month])
  const todayK = todayKey()

  return (
    <section className="calendar card" aria-label="日历">
      <header className="cal-header">
        <h2>
          {year} 年 {month + 1} 月
        </h2>
        <div className="cal-actions">
          <button type="button" className="icon-btn" onClick={onPrevMonth} aria-label="上个月">
            ‹
          </button>
          <button type="button" className="icon-btn" onClick={onNextMonth} aria-label="下个月">
            ›
          </button>
          <button type="button" className="today-btn" onClick={onToday}>
            今天
          </button>
        </div>
      </header>

      <div className="weekday-row">
        {WEEKDAYS.map(w => (
          <span key={w} className="weekday">
            {w}
          </span>
        ))}
      </div>

      <div className="grid">
        {cells.map(c => (
          <DayCell
            key={c.key}
            cell={c}
            isToday={c.key === todayK}
            isSelected={c.key === selectedKey}
            hasTodos={todoDates.has(c.key)}
            onClick={() => onPick(c.key)}
          />
        ))}
      </div>
    </section>
  )
}
