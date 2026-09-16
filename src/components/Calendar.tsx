import { useMemo } from 'react'
import { DayCell } from './DayCell'
import { WEEKDAYS, monthMatrix, todayKey } from '../utils/date'

interface Props {
  year: number
  /** 0 起始月份 */
  month: number
  selectedKey: string
  /** 当天有任意记录(打卡/流水/体重)的日期集合(绿点) */
  recorded: ReadonlySet<string>
  onPick: (key: string) => void
  onPrevMonth: () => void
  onNextMonth: () => void
  onToday: () => void
}

/**
 * 迷你月历导航器(v0.4):只负责"看哪天有记录 + 切日期",
 * 日历整体缩到左栏 ~236px;v0.4.1 起日程移除,圆点只剩"有记录"一色。
 */
export function Calendar({
  year,
  month,
  selectedKey,
  recorded,
  onPick,
  onPrevMonth,
  onNextMonth,
  onToday,
}: Props) {
  const cells = useMemo(() => monthMatrix(year, month), [year, month])
  const todayK = todayKey()

  return (
    <section className="rounded-box border border-base-300 bg-base-100 p-3.5 shadow-sm" aria-label="月历">
      <header className="mb-2 flex items-center justify-between">
        <h2 className="m-0 font-display text-[15px] font-semibold tracking-tight">
          {year} · {month + 1} 月
        </h2>
        <div className="flex items-center gap-0.5">
          <button type="button" className="btn btn-ghost btn-xs btn-square text-base" onClick={onPrevMonth} aria-label="上个月">
            ‹
          </button>
          <button type="button" className="btn btn-ghost btn-xs btn-square text-base" onClick={onNextMonth} aria-label="下个月">
            ›
          </button>
        </div>
      </header>

      <div className="grid grid-cols-7 gap-[3px]">
        {WEEKDAYS.map(w => (
          <span key={w} className="pb-0.5 text-center font-mono text-[10px] tracking-wide text-base-content/40">
            {w}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-[3px]" role="grid">
        {cells.map(c => (
          <DayCell
            key={c.key}
            cell={c}
            isToday={c.key === todayK}
            isSelected={c.key === selectedKey}
            hasRecord={recorded.has(c.key)}
            onClick={() => onPick(c.key)}
          />
        ))}
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-base-300 pt-2.5 font-mono text-[10px] tracking-wide text-base-content/45">
        <span className="inline-flex items-center gap-1">
          <i className="inline-block size-[5px] rounded-full bg-success" />
          有记录
        </span>
        <button type="button" className="btn btn-ghost btn-xs px-1.5 normal-case" onClick={onToday}>
          今天
        </button>
      </div>
    </section>
  )
}
