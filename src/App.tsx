import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Calendar } from './components/Calendar'
import { DayPanel } from './components/DayPanel'
import { ImportModal } from './components/ImportModal'
import { ProfileModal } from './components/ProfileModal'
import { AiConfigModal } from './components/AiConfigModal'
import { Toasts, type ToastData } from './components/Toasts'
import { useTodos } from './hooks/useTodos'
import { useHealth } from './hooks/useHealth'
import { todayDate, todayKey } from './utils/date'
import type { DotMark } from './types'

interface ImportResult {
  fetchedEvents: number
  imported: number
  duplicates: number
  skippedRecurring: number
  outOfWindow: number
}

export default function App() {
  const now = todayDate()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [selectedKey, setSelectedKey] = useState<string>(() => todayKey())
  const { store, getDay, addTodo, toggleTodo, removeTodo, reload } = useTodos()
  const { getDay: getHealthDay, addLog, patchLog, removeLog, store: healthStore } = useHealth()

  const [importOpen, setImportOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [aiConfigOpen, setAiConfigOpen] = useState(false)
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

  // 快捷键:Ctrl/Cmd+I 呼出导入;Esc 关闭
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
        await reload()
      } catch (err) {
        pushToast('error', `导入失败:${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [pushToast, reload],
  )

  // 圆点标记:日程=蓝,待办=琥珀,打卡=绿,同天可并存
  const marks = useMemo(() => {
    const m = new Map<string, DotMark[]>()
    for (const [k, list] of Object.entries(store)) {
      if (!list.length) continue
      const mk: DotMark[] = []
      if (list.some(t => t.source === 'ics')) mk.push('event')
      if (list.some(t => t.source !== 'ics')) mk.push('todo')
      m.set(k, mk)
    }
    for (const [k, list] of Object.entries(healthStore)) {
      if (!list.length) continue
      m.set(k, [...(m.get(k) ?? []), 'health'])
    }
    return m
  }, [store, healthStore])

  const prevMonth = () =>
    setYm(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))
  const nextMonth = () =>
    setYm(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))
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

  return (
    <div className="min-h-screen bg-base-200">
      {/* 顶栏 */}
      <header className="sticky top-0 z-20 border-b border-base-300 bg-base-100/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[1920px] flex-wrap items-center gap-4 px-8 py-3">
          <span className="mr-auto inline-flex items-center gap-2.5">
            <span className="btn btn-primary btn-square btn-sm font-mono text-xs font-bold">M</span>
            <span className="font-display text-lg font-semibold tracking-tight">MyCal</span>
            <span className="badge badge-ghost badge-sm">日常工作台</span>
          </span>

          <button type="button" className="btn btn-ghost btn-sm" onClick={goToday}>
            今天
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setImportOpen(true)}
            title="快捷键 Ctrl+I"
          >
            订阅
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setProfileOpen(true)}
            title="健康档案(AI 汇总会结合身体情况)"
          >
            档案
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setAiConfigOpen(true)}
            title="AI 服务配置"
          >
            AI
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-sm btn-square"
            onClick={toggleTheme}
            aria-label="切换深色模式"
          >
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

      {/* 工作区 */}
      <main className="mx-auto grid w-full max-w-[1920px] grid-cols-1 items-start gap-6 px-8 py-8 lg:grid-cols-[1.05fr_1fr]">
        <Calendar
          year={ym.y}
          month={ym.m}
          selectedKey={selectedKey}
          marks={marks}
          events={getDay(selectedKey).filter(t => t.source === 'ics')}
          onRemoveEvent={id => void removeTodo(selectedKey, id)}
          onPick={setSelectedKey}
          onPrevMonth={prevMonth}
          onNextMonth={nextMonth}
          onToday={goToday}
        />

        <DayPanel
          dateKey={selectedKey}
          todos={getDay(selectedKey).filter(t => t.source !== 'ics')}
          diaryLogs={getHealthDay(selectedKey)}
          onAdd={text => void addTodo(selectedKey, text)}
          onToggle={id => void toggleTodo(selectedKey, id)}
          onRemove={id => void removeTodo(selectedKey, id)}
          onDiaryAdd={input => addLog(selectedKey, input)}
          onDiaryPatch={(id, patch) => patchLog(selectedKey, id, patch)}
          onDiaryRemove={id => removeLog(selectedKey, id)}
          notify={pushToast}
          onOpenProfile={() => setProfileOpen(true)}
          onOpenAiConfig={() => setAiConfigOpen(true)}
        />
      </main>

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onSubmit={url => void importIcs(url)} />
      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} notify={pushToast} />
      <AiConfigModal open={aiConfigOpen} onClose={() => setAiConfigOpen(false)} notify={pushToast} />
      <Toasts items={toasts} onDismiss={id => setToasts(ts => ts.filter(t => t.id !== id))} />
    </div>
  )
}
