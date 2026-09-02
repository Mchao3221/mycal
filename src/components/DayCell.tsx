import type { CalendarCell } from '../utils/date'
import type { DotKind } from '../types'

interface Props {
  cell: CalendarCell
  isToday: boolean
  isSelected: boolean
  /** 当天条目类型:null = 无,local = 有本地待办,ics = 仅 ICS 日程 */
  dot: DotKind | null
  onClick: () => void
}

export function DayCell({ cell, isToday, isSelected, dot, onClick }: Props) {
  const cls = ['day-cell']
  if (!cell.inMonth) cls.push('outside')
  if (isToday) cls.push('today')
  if (isSelected) cls.push('selected')

  return (
    <button type="button" className={cls.join(' ')} onClick={onClick}>
      <span className="day-num">{cell.day}</span>
      {dot && <span className={dot === 'ics' ? 'dot ics' : 'dot'} aria-hidden />}
    </button>
  )
}
