import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Calendar } from './components/Calendar'
import { DayView } from './components/DayView'
import { ImportModal } from './components/ImportModal'
import { LockScreen } from './components/LockScreen'
import { ProfileModal } from './components/ProfileModal'
import { AiConfigModal } from './components/AiConfigModal'
import { WeightModal } from './components/WeightModal'
import { Toasts, type ToastData } from './components/Toasts'
import { WeightSparkline } from './components/WeightSparkline'
import { useEvents } from './hooks/useEvents'
import { useHealth } from './hooks/useHealth'
import { useJournal } from './hooks/useJournal'
import { useWeights } from './hooks/useWeights'
import { api } from './utils/api'
import { fmtKey, shiftKey, todayDate, todayKey } from './utils/date'
import { avgWithin, recordStreak, weightSeries } from './utils/stats'
import type { DotMark, LockStatus } from './types'

interface ImportResult {
  fetchedEvents: number
  imported: number
  duplicates: number
  skippedRecurring: number
  outOfWindow: number
}

type LockPhase = 'checking' | 'setup' | 'locked' | 'ready'

export default function App() {
  const [phase, setPhase] = useState<LockPhase>('checking')

  // 开屏先问锁状态:未设置访问码 → 设置流程;已设置且无有效会话 → 锁屏
  useEffect(() => {
    api<LockStatus>('/api/lock/status')
      .then(s => setPhase(!s.isSet ? 'setup' : s.unlocked ? 'ready' : 'locked'))
      .catch(() => setPhase('locked'))
  }, [])

  if (phase === 'checking') {
    return (
      <div className="grid min-h-dvh place-items-center bg-base-200">
        <span className="loading loading-ring loading-lg text-primary/60" />
      </div>
    )
  }
  if (phase === 'setup' || phase === 'locked') {
    return <LockScreen mode={phase} onUnlocked={() => setPhase('ready')} />
  }
  return <Workspace onLock={() => setPhase('locked')} />
}

// ---------- 解锁后的工作台 ----------

function Workspace({ onLock }: { onLock: () => void }) {
  const now = todayDate()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [selectedKey, setSelectedKey] = useState<string>(() => todayKey())
  const { store: eventStore, getDay: getEvents, removeEvent, reload: reloadEvents } = useEvents()
  const { getDay: getHealthDay, addLog, patchLog, removeLog, store: healthStore } = useHealth()
  const { getDay: getJournalDay, add: addJournal, patch: patchJournal, remove: removeJournal, store: journalStore } = useJournal()
  const { get: getWeight, setFor: setWeight, remove: removeWeight, store: weightStore } = useWeights()

  const [importOpen, setImportOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [aiConfigOpen, setAiConfigOpen] = useState(false)
  const [weightOpen, setWeightOpen] = useState(false)
  const [toasts, setToasts] = useState<ToastData[]>([])
  const toastSeq = useRef(0)
  const [isDark, setIsDark] = useState(
    () => document.documentElement.dataset.theme === 'dim',
  )

  const pushToast = useCallback((kind: ToastData['kind'], text: string) => {
    const id = ++toastSeq.current
    setToasts(ts => [...ts, { id, kind, text }])
    setTimeout(() => setToasts(ts => ts.filter(t => t.id !== id)), 4500)
  }, [])

  // 快捷键:Ctrl/Cmd+I 呼出订阅导入;Esc 关闭所有弹窗
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        setImportOpen(true)
      }
      if (e.key === 'Escape') {
        setImportOpen(false)
        setProfileOpen(false)
        setAiConfigOpen(false)
        setWeightOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 后台导入:弹窗立即收起,完成后 Toast 提示
  const importIcs = useCallback(
    async (url: string) => {
      setImportOpen(false)
      pushToast('success', `开始导入:${url}`)
      try {
        const res = await fetch('/api/ics/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        })
        const data = (await res.json()) as ImportResult & { error?: string }
        if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)

        const parts = [`成功导入 ${data.imported} 条日程`]
        if (data.duplicates) parts.push(`跳过重复 ${data.duplicates} 条`)
        if (data.skippedRecurring) parts.push(`重复规则未展开 ${data.skippedRecurring} 条`)
        pushToast('success', parts.join(' · '))
        await reloadEvents()
      } catch (err) {
        pushToast('error', `导入失败:${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [pushToast, reloadEvents],
  )

  const manualLock = useCallback(async () => {
    try {
      await api<{ ok: true }>('/api/lock/lock', { method: 'POST' })
      pushToast('success', '已上锁,所有设备需重新输入访问码')
      onLock()
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err))
    }
  }, [onLock, pushToast])

  // 圆点标记:日程=蓝;记录=绿(打卡/流水/体重任一);同天可并存
  const { marks, recordKeys } = useMemo(() => {
    const m = new Map<string, DotMark[]>()
    const recKeys = new Set<string>()
    for (const [k, list] of Object.entries(eventStore)) {
      if (list.some(t => t.source === 'ics')) m.set(k, [...(m.get(k) ?? []), 'event'])
    }
    for (const [k, list] of Object.entries(healthStore)) if (list.length) recKeys.add(k)
    for (const [k, list] of Object.entries(journalStore)) if (list.length) recKeys.add(k)
    for (const k of Object.keys(weightStore)) recKeys.add(k)
    for (const k of recKeys) m.set(k, [...(m.get(k) ?? []), 'record'])
    return { marks: m, recordKeys: recKeys }
  }, [eventStore, healthStore, journalStore, weightStore])

  const wSeries = useMemo(() => weightSeries(weightStore), [weightStore])
  const latestW = wSeries[wSeries.length - 1] ?? null
  const wVs7 = latestW ? avgWithin(wSeries, shiftKey(latestW.key, -1), 7) : null
  const wDelta = latestW && wVs7 != null ? Math.round((latestW.kg - wVs7) * 10) / 10 : null

  // 本月概况(跟随日历正在看的月份):有记录的天数 + 记录条数 + 连续天数
  const monthStats = useMemo(() => {
    const prefix = fmtKey(ym.y, ym.m, 1).slice(0, 7)
    let days = 0
    for (const k of recordKeys) if (k.startsWith(prefix)) days++
    let entries = 0
    for (const [k, l] of Object.entries(journalStore)) if (k.startsWith(prefix)) entries += l.length
    for (const [k, l] of Object.entries(healthStore)) if (k.startsWith(prefix)) entries += l.length
    return { days, entries, streak: recordStreak(recordKeys, todayKey()) }
  }, [recordKeys, journalStore, healthStore, ym])

  const prevMonth = () => setYm(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))
  const nextMonth = () => setYm(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))
  const goToday = () => {
    const t = todayDate()
    setYm({ y: t.getFullYear(), m: t.getMonth() })
    setSelectedKey(todayKey())
  }

  const toggleTheme = () => {
    const next = !isDark
    setIsDark(next)
    document.documentElement.dataset.theme = next ? 'dim' : 'mycal'
    try {
      localStorage.setItem('mycal:theme', next ? 'dim' : 'mycal')
    } catch {
      /* 忽略隐私模式 */
    }
  }

  // 桌面端(lg 及以上)锁定为整屏工作台:顶栏不动,左右两栏各自内部滚动;
  // 日历缩为左栏导航器,右栏是"一天所有记录"的日志主体。窄屏整页滚动。
  return (
    <div className="flex min-h-dvh flex-col bg-base-200 lg:h-dvh lg:overflow-hidden">
      {/* 顶栏 */}
      <header className="sticky top-0 z-20 flex-none border-b border-base-300 bg-base-100/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[1920px] flex-wrap items-center gap-4 px-8 py-3">
          <span className="mr-auto inline-flex items-center gap-2.5">
            <span className="btn btn-primary btn-square btn-sm font-mono text-xs font-bold">M</span>
            <span className="font-display text-lg font-semibold tracking-tight">MyCal</span>
            <span className="badge badge-ghost badge-sm">私人健康日志</span>
          </span>

          <button type="button" className="btn btn-ghost btn-sm" onClick={goToday}>
            今天
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setImportOpen(true)} title="快捷键 Ctrl+I">
            订阅
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setProfileOpen(true)} title="健康档案(AI 汇总会结合身体情况)">
            档案
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAiConfigOpen(true)} title="AI 服务配置">
            AI
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void manualLock()} title="立即上锁:所有设备需重新解锁">
            🔒 上锁
          </button>

          <button type="button" className="btn btn-ghost btn-sm btn-square" onClick={toggleTheme} aria-label="切换深色模式">
            {isDark ? (
              <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
            ) : (
              <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* 工作区:左导航右日志,两栏等高各自滚动 */}
      <main className="mx-auto grid w-full max-w-[1920px] flex-1 grid-cols-1 items-start gap-6 px-8 py-8 lg:min-h-0 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-stretch lg:overflow-hidden">
        <div className="panel-scroll flex flex-col gap-5 lg:min-h-0 lg:overflow-y-auto">
          <Calendar
            year={ym.y}
            month={ym.m}
            selectedKey={selectedKey}
            marks={marks}
            onPick={setSelectedKey}
            onPrevMonth={prevMonth}
            onNextMonth={nextMonth}
            onToday={goToday}
          />

          <section className="rounded-box border border-base-300 bg-base-100 p-4 shadow-sm" aria-label="本月概况">
            <h3 className="m-0 font-mono text-[11px] uppercase tracking-[0.08em] text-base-content/45">
              {ym.m === now.getMonth() ? '本月概况' : `${ym.m + 1} 月概况`}
            </h3>
            <div className="mt-2 flex items-baseline gap-4 font-mono text-xs text-base-content/60">
              <span>
                记录 <b className="text-base-content text-sm tabular-nums">{monthStats.days}</b> 天
              </span>
              <span>
                <b className="text-base-content text-sm tabular-nums">{monthStats.entries}</b> 条
              </span>
              {monthStats.streak > 1 && (
                <span className="text-warning">🔥 连续 {monthStats.streak} 天</span>
              )}
            </div>
          </section>

          <button
            type="button"
            className="rounded-box border border-base-300 bg-base-100 p-4 text-left shadow-sm transition-colors hover:border-primary/40"
            onClick={() => setWeightOpen(true)}
            aria-label="打开体重曲线"
          >
            <span className="flex items-baseline justify-between font-mono text-[11px] uppercase tracking-[0.08em] text-base-content/45">
              体重走势
              <span className="normal-case tracking-normal text-primary/70">曲线/BMI ›</span>
            </span>
            <span className="mt-1 flex items-baseline gap-2">
              <b className="font-display text-2xl font-semibold tabular-nums">
                {latestW ? latestW.kg.toFixed(1) : '—'}
              </b>
              <small className="font-mono text-xs text-base-content/50">
                {latestW ? `kg · ${latestW.key.slice(5)}` : 'kg · 点击查看'}
              </small>
              {wDelta != null && (
                <small className={`font-mono text-xs tabular-nums ${wDelta <= 0 ? 'text-success' : 'text-warning'}`}>
                  {wDelta > 0 ? '+' : ''}
                  {wDelta.toFixed(1)}/周
                </small>
              )}
            </span>
            <span className="mt-1 block">
              <WeightSparkline series={wSeries} />
            </span>
          </button>
        </div>

        <DayView
          dateKey={selectedKey}
          events={getEvents(selectedKey)}
          onRemoveEvent={id => void removeEvent(selectedKey, id).catch(err => pushToast('error', String(err)))}
          journal={getJournalDay(selectedKey)}
          onJournalAdd={text => addJournal(selectedKey, text)}
          onJournalPatch={(id, text) => patchJournal(selectedKey, id, text)}
          onJournalRemove={id => removeJournal(selectedKey, id)}
          weight={getWeight(selectedKey)}
          weightSeriesUpToDay={wSeries}
          onSaveWeight={async kg => {
            await setWeight(selectedKey, kg)
          }}
          onClearWeight={async () => {
            await removeWeight(selectedKey)
          }}
          diaryLogs={getHealthDay(selectedKey)}
          onDiaryAdd={input => addLog(selectedKey, input)}
          onDiaryPatch={(id, patch) => patchLog(selectedKey, id, patch)}
          onDiaryRemove={id => removeLog(selectedKey, id)}
          notify={pushToast}
        />
      </main>

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onSubmit={url => void importIcs(url)} />
      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} notify={pushToast} />
      <AiConfigModal open={aiConfigOpen} onClose={() => setAiConfigOpen(false)} notify={pushToast} />
      <WeightModal
        open={weightOpen}
        onClose={() => setWeightOpen(false)}
        series={wSeries}
        onUpsert={async (key, kg) => {
          await setWeight(key, kg)
        }}
        onRemove={async key => {
          await removeWeight(key)
        }}
        notify={pushToast}
      />
      <Toasts items={toasts} onDismiss={id => setToasts(ts => ts.filter(t => t.id !== id))} />
    </div>
  )
}
