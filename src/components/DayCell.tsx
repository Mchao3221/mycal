import type { CalendarCell } from '../utils/date'
import type { DotMark } from '../types'

interface Props {
  cell: CalendarCell
  isToday: boolean
  isSelected: boolean
  /** 当天标记:event=日程(蓝) record=有记录(绿) */
  marks: readonly DotMark[]
  onClick: () => void
}

const DOT_COLOR: Record<DotMark, string> = {
  event: 'bg-primary',
  record: 'bg-success',
}

/** 迷你格子:数字 + 至多两个圆点,整体一行高,给密度让路 */
export function DayCell({ cell, isToday, isSelected, marks, onClick }: Props) {
  const cls = [
    'flex h-8 cursor-pointer flex-col items-center justify-center gap-[2px] rounded-md',
    'font-mono text-[12px] tabular-nums transition-colors duration-150',
    'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
    !cell.inMonth ? 'text-base-content/25' : 'text-base-content',
    isSelected
      ? 'bg-primary font-semibold text-primary-content'
      : 'hover:bg-base-content/5',
    isToday && !isSelected
      ? 'shadow-[inset_0_0_0_2px_var(--color-primary)] font-semibold'
      : '',
  ].join(' ')

  return (
    <button type="button" className={cls} onClick={onClick} aria-label={cell.key} title={cell.key}>
      <span>{cell.day}</span>
      {marks.length > 0 && (
        <span className="flex gap-[2px]">
          {marks.map(m => (
            <i
              key={m}
              className={`size-[3px] rounded-full ${isSelected ? 'bg-primary-content/90' : DOT_COLOR[m]}`}
            />
          ))}
        </span>
      )}
    </button>
  )
}
