import { useMemo } from 'react'
import { DayCell } from './DayCell'
import { WEEKDAYS, monthMatrix, todayKey, weekOfYear } from '../utils/date'
import type { DotMark, Todo } from '../types'

interface Props {
  year: number
  /** 0 起始月份 */
  month: number
  selectedKey: string
  /** 各日期标记(用于圆点着色) */
  marks: ReadonlyMap<string, DotMark[]>
  /** 选中日的 ICS 日程(source === 'ics'),展示在月历下方 */
  events: Todo[]
  onRemoveEvent: (id: string) => void
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
  events,
  onRemoveEvent,
  onPick,
  onPrevMonth,
  onNextMonth,
  onToday,
}: Props) {
  const cells = useMemo(() => monthMatrix(year, month), [year, month])
  const todayK = todayKey()

  const [sy, sm, sd] = selectedKey.split('-').map(Number)
  const weekTag = useMemo(
    () => `第 ${weekOfYear(new Date(sy, sm - 1, sd))} 周`,
    [sy, sm, sd],
  )

  // 桌面端整卡撑满列高:月历格子自动拉伸,内容过多时在卡片内部滚动,不影响页面
  return (
    <section
      className="rounded-box border border-base-300 bg-base-100 shadow-sm lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:overflow-hidden"
      aria-label="月历"
    >
      <div className="panel-scroll p-6 pb-5 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-y-auto">
        <header className="mb-4 flex items-center justify-between lg:shrink-0">
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

        <div className="grid grid-cols-7 gap-[5px] lg:shrink-0">
          {WEEKDAYS.map(w => (
            <span
              key={w}
              className="pb-2 text-center font-mono text-[11px] tracking-wide text-base-content/45"
            >
              {w}
            </span>
          ))}
        </div>

        <div
          className="grid grid-cols-7 gap-[5px] lg:auto-rows-[minmax(60px,1fr)] lg:flex-1"
          role="grid"
        >
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

        <div className="mt-3.5 flex items-center gap-4 border-t border-base-300 pt-3.5 font-mono text-[11px] tracking-wide text-base-content/50 lg:shrink-0">
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

        {events.length > 0 && (
          <div className="mt-3 border-t border-base-300 pt-3 lg:shrink-0">
            <h3 className="mb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-base-content/45">
              日程 · {sm} 月 {sd} 日
            </h3>
            <ul className="panel-scroll m-0 max-h-[260px] list-none overflow-y-auto p-0 pr-1">
              {events.map(t => {
                const mt = t.text.match(/^(\d{2}:\d{2})\s+(.*)$/)
                return (
                  <li
                    key={t.id}
                    className="grid grid-cols-[64px_1fr] items-start gap-3 border-b border-base-300 py-2 last:border-b-0"
                  >
                    <div className="pt-0.5 font-mono text-[12px] tabular-nums text-primary">
                      {mt ? mt[1] : '全天'}
                    </div>
                    <div className="relative pl-3 before:absolute before:bottom-1 before:left-0 before:top-1 before:w-[3px] before:rounded-full before:bg-primary/30">
                      <div className="text-sm leading-snug">{mt ? mt[2] : t.text}</div>
                      <button
                        type="button"
                        className="text-xs text-base-content/30 transition-colors hover:text-secondary"
                        onClick={() => onRemoveEvent(t.id)}
                        aria-label={`移除日程:${t.text}`}
                      >
                        ✕ 移除
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
