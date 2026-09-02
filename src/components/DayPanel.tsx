import { useEffect, useState } from 'react'
import type { Todo } from '../types'
import { weekdayLabel } from '../utils/date'

interface Props {
  /** YYYY-MM-DD */
  dateKey: string
  todos: Todo[]
  onAdd: (text: string) => void
  onToggle: (id: string) => void
  onRemove: (id: string) => void
}

export function DayPanel({ dateKey, todos, onAdd, onToggle, onRemove }: Props) {
  const [draft, setDraft] = useState('')

  // 切换日期时清空输入框
  useEffect(() => setDraft(''), [dateKey])

  const [y, m, d] = dateKey.split('-').map(Number)
  const doneCount = todos.filter(t => t.done).length

  const submit = () => {
    const text = draft.trim()
    if (!text) return
    onAdd(text)
    setDraft('')
  }

  return (
    <section className="day-panel card" aria-label="当日待办">
      <header>
        <h2>
          {m} 月 {d} 日 · {weekdayLabel(y, m - 1, d)}
        </h2>
        {todos.length > 0 && (
          <p className="stats">
            共 {todos.length} 项 · 完成 {doneCount} 项
          </p>
        )}
      </header>

      <ul className="todo-list">
        {todos.map(t => (
          <li key={t.id} className={t.done ? 'done' : ''}>
            <label>
              <input
                type="checkbox"
                checked={t.done}
                onChange={() => onToggle(t.id)}
                aria-label={`完成:${t.text}`}
              />
              <span className="todo-text">{t.text}</span>
            </label>
            <button
              type="button"
              className="del-btn"
              onClick={() => onRemove(t.id)}
              aria-label={`删除:${t.text}`}
            >
              ✕
            </button>
          </li>
        ))}
        {todos.length === 0 && <li className="empty">这天还没有待办,加一条吧</li>}
      </ul>

      <form
        className="add-row"
        onSubmit={e => {
          e.preventDefault()
          submit()
        }}
      >
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="新待办…回车添加"
          aria-label="新待办"
        />
        <button type="submit" disabled={!draft.trim()}>
          添加
        </button>
      </form>
    </section>
  )
}
