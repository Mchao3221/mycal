import type { HealthLog, HealthLogInput, JournalEntry, WeightEntry } from '../types'
import { AiSummaryPanel } from './AiSummaryPanel'
import { DiaryPanel } from './DiaryPanel'
import { JournalPanel } from './JournalPanel'
import { WeightToday } from './WeightToday'
import { shiftKey, todayKey, weekOfYear, weekdayLabel } from '../utils/date'
import type { WeightPoint } from '../utils/stats'

interface Props {
  dateKey: string
  journal: JournalEntry[]
  onJournalAdd: (text: string) => Promise<void>
  onJournalPatch: (id: string, text: string) => Promise<void>
  onJournalRemove: (id: string) => Promise<void>
  weight: WeightEntry | null
  weightSeriesUpToDay: WeightPoint[]
  onSaveWeight: (kg: number) => Promise<void>
  onClearWeight: () => Promise<void>
  diaryLogs: HealthLog[]
  onDiaryAdd: (input: HealthLogInput) => Promise<void>
  onDiaryPatch: (id: string, patch: Partial<HealthLogInput>) => Promise<void>
  onDiaryRemove: (id: string) => Promise<void>
  notify: (kind: 'success' | 'error', text: string) => void
  /** AI 汇总生成后:让上层刷新条目(AI 估算的热量回填) */
  onSummaryGenerated: () => void
}

/**
 * 右栏主体,左右分栏:左 = 当天的记录(流水 → 体重 → 吃动打卡),右 = AI 汇总独立面板。
 * 记录条目不再横跨整屏,汇总也有足够纵深;窄屏堆叠,汇总垫底。
 */
export function DayView({
  dateKey,
  journal,
  onJournalAdd,
  onJournalPatch,
  onJournalRemove,
  weight,
  weightSeriesUpToDay,
  onSaveWeight,
  onClearWeight,
  diaryLogs,
  onDiaryAdd,
  onDiaryPatch,
  onDiaryRemove,
  notify,
  onSummaryGenerated,
}: Props) {
  const [y, m, d] = dateKey.split('-').map(Number)
  const isToday = dateKey === todayKey()
  // 近 7 日均值:截至昨天(排除当天值自参照),让"较7日均"反映相对习惯的偏离
  const avg7 = (() => {
    const from = shiftKey(dateKey, -6)
    const inWin = weightSeriesUpToDay.filter(p => p.key >= from && p.key < dateKey)
    if (!inWin.length) return null
    return Math.round((inWin.reduce((s, p) => s + p.kg, 0) / inWin.length) * 10) / 10
  })()

  return (
    <section
      className="rounded-box border border-base-300 bg-base-100 shadow-sm lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:overflow-hidden"
      aria-label="当日日志"
    >
      {/* 日期标题:横跨整卡 */}
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-6 pt-5 pb-3 lg:shrink-0">
        <h2 className="m-0 font-display text-2xl font-semibold tracking-tight lg:text-3xl">
          {m} 月 {d} 日
        </h2>
        <span className="font-mono text-xs text-base-content/50">
          周{weekdayLabel(y, m - 1, d)} · 第 {weekOfYear(new Date(y, m - 1, d))} 周 · {y}
        </span>
        {isToday && <span className="badge badge-primary badge-sm">今天</span>}
      </header>

      <div className="flex flex-col lg:min-h-0 lg:flex-1 lg:flex-row lg:overflow-hidden">
        {/* 左:当天的记录流 */}
        <div className="panel-scroll min-w-0 flex-1 space-y-5 px-6 pb-6 lg:overflow-y-auto">
          <JournalPanel
            dateKey={dateKey}
            entries={journal}
            onAdd={onJournalAdd}
            onPatch={onJournalPatch}
            onRemove={onJournalRemove}
            notify={notify}
          />

          <div className="border-t border-base-300" />

          <WeightToday
            dateKey={dateKey}
            entry={weight}
            avg7={avg7}
            onSave={onSaveWeight}
            onClear={onClearWeight}
            notify={notify}
          />

          <div className="border-t border-base-300" />

          <h3 className="m-0 -mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-base-content/45">
            🍽 吃动打卡
          </h3>
          <DiaryPanel
            logs={diaryLogs}
            onAdd={onDiaryAdd}
            onPatch={onDiaryPatch}
            onRemove={onDiaryRemove}
            notify={notify}
          />
        </div>

        {/* 右:AI 汇总独立面板 */}
        <aside className="panel-scroll border-t border-base-300 bg-base-200/30 px-5 py-5 lg:w-[540px] lg:flex-none lg:overflow-y-auto lg:border-t-0 lg:border-l">
          <AiSummaryPanel dateKey={dateKey} notify={notify} onGenerated={onSummaryGenerated} />
        </aside>
      </div>
    </section>
  )
}
