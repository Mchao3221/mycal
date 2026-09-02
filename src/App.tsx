import { useMemo, useState } from 'react'
import { Calendar } from './components/Calendar'
import { DayPanel } from './components/DayPanel'
import { useTodos } from './hooks/useTodos'
import { todayDate, todayKey } from './utils/date'

export default function App() {
  const now = todayDate()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [selectedKey, setSelectedKey] = useState<string>(() => todayKey())
  const { store, getDay, addTodo, toggleTodo, removeTodo } = useTodos()

  // 有待办的日期集合,用于日历圆点
  const todoDates = useMemo(
    () => new Set(Object.keys(store).filter(k => (store[k]?.length ?? 0) > 0)),
    [store],
  )

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

      <div className="panels">
        <Calendar
          year={ym.y}
          month={ym.m}
          selectedKey={selectedKey}
          todoDates={todoDates}
          onPick={setSelectedKey}
          onPrevMonth={prevMonth}
          onNextMonth={nextMonth}
          onToday={goToday}
        />

        <DayPanel
          dateKey={selectedKey}
          todos={getDay(selectedKey)}
          onAdd={text => addTodo(selectedKey, text)}
          onToggle={id => toggleTodo(selectedKey, id)}
          onRemove={id => removeTodo(selectedKey, id)}
        />
      </div>

      <footer className="foot">数据保存在浏览器本地(localStorage),仅本机可见</footer>
    </main>
  )
}
