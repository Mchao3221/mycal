import { useEffect, useState } from 'react'
import type { Todo } from '../types'
import { todayKey, weekOfYear, weekdayLabel } from '../utils/date'

interface Props {
  /** YYYY-MM-DD */
  dateKey: string
  /** 本地待办(source !== 'ics') */
  todos: Todo[]
  /** ICS 日程(source === 'ics') */
  events: Todo[]
  onAdd: (text: string) => void
  onToggle: (id: string) => void
  onRemove: (id: string) => void
}

type Tab = 'todo' | 'sched'

export function DayPanel({ dateKey, todos, events, onAdd, onToggle, onRemove }: Props) {
  const [tab, setTab] = useState<Tab>('todo')
  const [draft, setDraft] = useState('')

  // 切换日期时清空输入框
  useEffect(() => setDraft(''), [dateKey])

  const [y, m, d] = dateKey.split('-').map(Number)
  const dateObj = new Date(y, m - 1, d)
  const isToday = dateKey === todayKey()
  const doneCount = todos.filter(t => t.done).length

  const submit = () => {
    const text = draft.trim()
    if (!text) return
    onAdd(text)
    setDraft('')
  }

  return (
    <section
      className="rounded-box border border-base-300 bg-base-100 p-6 shadow-sm lg:p-7"
      aria-label="当日详情"
    >
      <header className="flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-base-content/50">
          当日概览
        </span>
        <span className="font-mono text-xs text-base-content/50">
          {isToday && <span className="mr-1.5 text-primary">今天 ·</span>}
          星期{weekdayLabel(y, m - 1, d)}
        </span>
      </header>

      <h2 className="mb-0 mt-1 leading-none">
        <span className="font-display text-[clamp(30px,3.2vw,44px)] font-semibold tracking-tight">
          {m} 月 {d} 日
        </span>
        <span className="ml-1.5 align-[0.4em] font-mono text-sm font-normal text-base-content/45">
          {y}
        </span>
      </h2>
      <p className="mb-5 mt-2 font-mono text-[13px] text-base-content/55">
        第 {weekOfYear(dateObj)} 周
      </p>

      <div className="mb-5 flex items-center gap-3">
        <span className="whitespace-nowrap font-mono text-xs text-base-content/55">
          {doneCount} / {todos.length} 待办完成
        </span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-base-300">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: todos.length ? `${(doneCount / todos.length) * 100}%` : '0%' }}
          />
        </div>
      </div>

      <div
        className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-base-300/60 p-1"
        role="tablist"
      >
        <button
          type="button"
          className={`seg-btn ${tab === 'todo' ? 'active' : ''}`}
          role="tab"
          aria-selected={tab === 'todo'}
          onClick={() => setTab('todo')}
        >
          待办 <span className="seg-cnt">{todos.length}</span>
        </button>
        <button
          type="button"
          className={`seg-btn ${tab === 'sched' ? 'active' : ''}`}
          role="tab"
          aria-selected={tab === 'sched'}
          onClick={() => setTab('sched')}
        >
          日程 <span className="seg-cnt">{events.length}</span>
        </button>
      </div>

      {tab === 'todo' ? (
        <>
          <ul className="m-0 max-h-[520px] list-none overflow-y-auto p-0 pr-1">
            {todos.map(t => (
              <li key={t.id} className="flex items-start gap-3 border-b border-base-300 py-3">
                <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={t.done}
                    onChange={() => onToggle(t.id)}
                  />
                  <span
                    className={`mt-0.5 grid size-5 flex-none place-items-center rounded-md border-[1.5px] transition-colors ${
                      t.done ? 'border-primary bg-primary' : 'border-base-300'
                    }`}
                  >
                    <svg
                      className={`size-3 stroke-base-100 transition-opacity ${
                        t.done ? 'opacity-100' : 'opacity-0'
                      }`}
                      viewBox="0 0 24 24"
                      fill="none"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </span>
                  <span
                    className={`text-[15px] leading-snug ${
                      t.done ? 'text-base-content/45 line-through decoration-base-300' : ''
                    }`}
                  >
                    {t.text}
                  </span>
                </label>
                <button
                  type="button"
                  className="grid size-[26px] flex-none place-items-center rounded-md text-base-content/30 transition-colors hover:bg-secondary/10 hover:text-secondary"
                  onClick={() => onRemove(t.id)}
                  aria-label={`删除:${t.text}`}
                >
                  ✕
                </button>
              </li>
            ))}
            {todos.length === 0 && (
              <li className="py-8 text-center text-sm text-base-content/50">
                这天还没有待办
                <small className="mt-1.5 block font-mono text-xs">在下方输入,回车即可添加</small>
              </li>
            )}
          </ul>

          <form
            className="mt-4 flex gap-2"
            onSubmit={e => {
              e.preventDefault()
              submit()
            }}
          >
            <input
              className="input input-bordered w-full bg-base-100"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder="新待办…回车添加"
              aria-label="新待办"
            />
            <button type="submit" className="btn btn-primary px-5" disabled={!draft.trim()}>
              添加
            </button>
          </form>
        </>
      ) : (
        <ul className="m-0 max-h-[520px] list-none overflow-y-auto p-0 pr-1">
          {events.map(t => {
            const mt = t.text.match(/^(\d{2}:\d{2})\s+(.*)$/)
            return (
              <li
                key={t.id}
                className="grid grid-cols-[96px_1fr] items-start gap-3.5 border-b border-base-300 py-3"
              >
                <div className="pt-0.5 font-mono text-[13px] tabular-nums text-primary">
                  {mt ? mt[1] : '全天'}
                </div>
                <div className="relative pl-4 before:absolute before:bottom-1.5 before:left-0 before:top-1.5 before:w-[3px] before:rounded-full before:bg-primary/30">
                  <div className="text-[15px] leading-snug">{mt ? mt[2] : t.text}</div>
                  <button
                    type="button"
                    className="mt-1 text-xs text-base-content/30 transition-colors hover:text-secondary"
                    onClick={() => onRemove(t.id)}
                    aria-label={`移除日程:${t.text}`}
                  >
                    ✕ 移除
                  </button>
                </div>
              </li>
            )
          })}
          {events.length === 0 && (
            <li className="py-8 text-center text-sm text-base-content/50">
              这天没有日程
              <small className="mt-1.5 block font-mono text-xs">按 Ctrl+I 导入 .ics 订阅</small>
            </li>
          )}
        </ul>
      )}
    </section>
  )
}
