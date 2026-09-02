import type { CalendarCell } from '../utils/date'
import type { DotMark } from '../types'

interface Props {
  cell: CalendarCell
  isToday: boolean
  isSelected: boolean
  /** 当天标记列表:event=日程(蓝) todo=待办(琥珀) */
  marks: readonly DotMark[]
  onClick: () => void
}

export function DayCell({ cell, isToday, isSelected, marks, onClick }: Props) {
  const cls = [
    'relative flex min-h-[60px] cursor-pointer flex-col items-center rounded-[10px] pt-2 font-mono text-[15px] transition-colors duration-150',
    'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
    !cell.inMonth ? 'text-base-content/25' : 'text-base-content',
    !isSelected ? 'hover:bg-base-content/5' : 'bg-primary font-semibold text-primary-content',
    isToday && !isSelected
      ? 'shadow-[inset_0_0_0_2px_var(--color-primary)] font-semibold'
      : '',
  ].join(' ')

  const dots = marks.map(m => (
    <span
      key={m}
      className={`size-1.5 rounded-full ${
        isSelected ? 'bg-primary-content/90' : m === 'event' ? 'bg-primary' : 'bg-secondary'
      }`}
    />
  ))

  return (
    <button type="button" className={cls} onClick={onClick} aria-label={cell.key}>
      <span className="tabular-nums">{cell.day}</span>
      {dots.length > 0 && <span className="mt-1.5 flex gap-[3px]">{dots}</span>}
    </button>
  )
}
