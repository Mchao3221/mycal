import type { HealthLog, HealthLogInput, JournalEntry, Todo, WeightEntry } from '../types'
import { DiaryPanel } from './DiaryPanel'
import { JournalPanel } from './JournalPanel'
import { WeightToday } from './WeightToday'
import { shiftKey, todayKey, weekOfYear, weekdayLabel } from '../utils/date'
import type { WeightPoint } from '../utils/stats'

interface Props {
  dateKey: string
  /** 当天 ICS 日程 */
  events: Todo[]
  onRemoveEvent: (id: string) => void
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
}

/** 右栏主体:一天的所有记录(流水 → 体重 → 吃动打卡 + AI 汇总)在同一张卡里纵向铺开 */
export function DayView({
  dateKey,
  events,
  onRemoveEvent,
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
      <div className="panel-scroll p-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {/* 日期标题 */}
        <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="m-0 font-display text-2xl font-semibold tracking-tight lg:text-3xl">
            {m} 月 {d} 日
          </h2>
          <span className="font-mono text-xs text-base-content/50">
            周{weekdayLabel(y, m - 1, d)} · 第 {weekOfYear(new Date(y, m - 1, d))} 周 · {y}
          </span>
          {isToday && <span className="badge badge-primary badge-sm">今天</span>}
        </header>

        {/* 日程:常驻卡片(无日程显示占位行),避免切换日期时整块出现/消失导致布局跳动 */}
        <div className="mb-5 rounded-xl border border-base-300 bg-base-200/40 px-4 py-2.5">
          <h3 className="mb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-base-content/45">
            日程 · {events.length}
          </h3>
          {events.length > 0 ? (
            <ul className="m-0 list-none p-0">
              {events.map(t => {
                const mt = t.text.match(/^(\d{2}:\d{2})\s+(.*)$/)
                return (
                  <li key={t.id} className="grid grid-cols-[52px_1fr_auto] items-center gap-2 border-b border-base-300/60 py-1.5 text-sm last:border-b-0">
                    <span className="font-mono text-xs tabular-nums text-primary">{mt ? mt[1] : '全天'}</span>
                    <span className="min-w-0 truncate" title={t.text}>
                      {mt ? mt[2] : t.text}
                    </span>
                    <button
                      type="button"
                      className="text-xs text-base-content/30 transition-colors hover:text-secondary"
                      onClick={() => onRemoveEvent(t.id)}
                      aria-label={`移除日程:${t.text}`}
                    >
                      ✕
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="py-1.5 text-sm text-base-content/35">该日暂无日程</div>
          )}
        </div>

        {/* 当日流水 */}
        <JournalPanel
          dateKey={dateKey}
          entries={journal}
          onAdd={onJournalAdd}
          onPatch={onJournalPatch}
          onRemove={onJournalRemove}
          notify={notify}
        />

        <div className="my-5 border-t border-base-300" />

        {/* 今日体重 */}
        <WeightToday
          dateKey={dateKey}
          entry={weight}
          avg7={avg7}
          onSave={onSaveWeight}
          onClear={onClearWeight}
          notify={notify}
        />

        <div className="my-5 border-t border-base-300" />

        {/* 吃动打卡 + AI 汇总 */}
        <DiaryPanel
          dateKey={dateKey}
          logs={diaryLogs}
          onAdd={onDiaryAdd}
          onPatch={onDiaryPatch}
          onRemove={onDiaryRemove}
          notify={notify}
        />
      </div>
    </section>
  )
}
