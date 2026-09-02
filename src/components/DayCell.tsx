import type { CalendarCell } from '../utils/date'

interface Props {
  cell: CalendarCell
  isToday: boolean
  isSelected: boolean
  hasTodos: boolean
  onClick: () => void
}

export function DayCell({ cell, isToday, isSelected, hasTodos, onClick }: Props) {
  const cls = ['day-cell']
  if (!cell.inMonth) cls.push('outside')
  if (isToday) cls.push('today')
  if (isSelected) cls.push('selected')

  return (
    <button type="button" className={cls.join(' ')} onClick={onClick}>
      <span className="day-num">{cell.day}</span>
      {hasTodos && <span className="dot" aria-hidden />}
    </button>
  )
}
