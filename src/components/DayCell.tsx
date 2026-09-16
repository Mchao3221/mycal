import type { CalendarCell } from '../utils/date'

interface Props {
  cell: CalendarCell
  isToday: boolean
  isSelected: boolean
  /** 当天有任意记录(打卡/流水/体重)→ 绿点 */
  hasRecord: boolean
  onClick: () => void
}

/** 迷你格子:数字 + 至多一个圆点,整体一行高,给密度让路 */
export function DayCell({ cell, isToday, isSelected, hasRecord, onClick }: Props) {
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
      {hasRecord && (
        <i className={`size-[3px] rounded-full ${isSelected ? 'bg-primary-content/90' : 'bg-success'}`} />
      )}
    </button>
  )
}
