import { useMemo, useState } from 'react'
import { Calendar } from './components/Calendar'
import { DayPanel } from './components/DayPanel'
import { ImportBar } from './components/ImportBar'
import { useTodos } from './hooks/useTodos'
import { todayDate, todayKey } from './utils/date'
import type { DotKind } from './types'

export default function App() {
  const now = todayDate()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [selectedKey, setSelectedKey] = useState<string>(() => todayKey())
  const { store, getDay, addTodo, toggleTodo, removeTodo, reload } = useTodos()

  // 圆点着色:本地待办优先琥珀;仅 ICS 日程为蓝
  const marks = useMemo(() => {
    const m = new Map<string, DotKind>()
    for (const [k, list] of Object.entries(store)) {
      if (!list.length) continue
      m.set(k, list.some(t => t.source !== 'ics') ? 'local' : 'ics')
    }
    return m
  }, [store])

  const prevMonth = () =>
    setYm(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))
  const nextMonth = () =>
    setYm(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))
  const goToday = () => {
    const t = todayDate()
    setYm({ y: t.getFullYear(), m: t.getMonth() })
    setSelectedKey(todayKey())
  }

  return (
    <main className="layout">
      <h1 className="app-title">MyCal · 日常工作台</h1>

      <ImportBar onImported={reload} />

      <div className="panels">
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

        <DayPanel
          dateKey={selectedKey}
          todos={getDay(selectedKey)}
          onAdd={text => void addTodo(selectedKey, text)}
          onToggle={id => void toggleTodo(selectedKey, id)}
          onRemove={id => void removeTodo(selectedKey, id)}
        />
      </div>

      <footer className="foot">数据保存在本地 SQLite(data/mycal.db)· 支持 .ics 订阅导入</footer>
    </main>
  )
}
