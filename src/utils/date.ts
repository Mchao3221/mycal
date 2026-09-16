/** 周一打头的星期表 */
export const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 拼 localStorage 的日期 key。month 为 0 起始 */
export function fmtKey(y: number, m: number, d: number): string {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`
}

/** 日期 key 偏移 n 天(按 UTC 整数日运算,规避夏令时/月份进位问题) */
export function shiftKey(key: string, deltaDays: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + deltaDays))
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`
}

export function todayDate(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

export function todayKey(): string {
  const t = todayDate()
  return fmtKey(t.getFullYear(), t.getMonth(), t.getDate())
}

/** ISO 周数 */
export function weekOfYear(d: Date): number {
  const t = new Date(d)
  t.setHours(0, 0, 0, 0)
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7))
  const wk4 = new Date(t.getFullYear(), 0, 4)
  return 1 + Math.round(((t.getTime() - wk4.getTime()) / 86400000 - (wk4.getDay() + 6) % 7 + 7) / 7)
}

/** 0=周一 … 6=周日 */
export function weekdayLabel(y: number, m: number, d: number): string {
  return WEEKDAYS[(new Date(y, m, d).getDay() + 6) % 7]
}

export interface CalendarCell {
  key: string
  day: number
  /** 是否属于当前显示的月份 */
  inMonth: boolean
}

/** 6 行 × 7 列的月历矩阵(周一打头),包含前后月补位 */
export function monthMatrix(year: number, month: number): CalendarCell[] {
  const lead = (new Date(year, month, 1).getDay() + 6) % 7
  const cells: CalendarCell[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month, 1 - lead + i)
    cells.push({
      key: fmtKey(d.getFullYear(), d.getMonth(), d.getDate()),
      day: d.getDate(),
      inMonth: d.getMonth() === month,
    })
  }
  return cells
}
