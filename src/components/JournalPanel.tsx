import { useEffect, useRef, useState } from 'react'
import type { JournalEntry } from '../types'

interface Props {
  dateKey: string
  entries: JournalEntry[]
  onAdd: (text: string) => Promise<void>
  onPatch: (id: string, text: string) => Promise<void>
  onRemove: (id: string) => Promise<void>
  notify: (kind: 'success' | 'error', text: string) => void
}

const hhmm = (ts: number) =>
  new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

/**
 * 当日流水:记录"今天做了哪些事"(事后视角,不是待办)。
 * 多条时间序,行内可改可删,AI 日汇总会消化这些内容。
 */
export function JournalPanel({ dateKey, entries, onAdd, onPatch, onRemove, notify }: Props) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const editRef = useRef<HTMLInputElement>(null)

  // 切日期:清输入、退编辑
  useEffect(() => {
    setDraft('')
    setEditId(null)
  }, [dateKey])

  useEffect(() => {
    if (editId) editRef.current?.focus()
  }, [editId])

  const run = (fn: () => Promise<void>) => async () => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      notify('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const submit = run(async () => {
    const text = draft.trim()
    if (!text) return
    await onAdd(text)
    setDraft('')
  })

  const saveEdit = run(async () => {
    if (!editId) return
    const text = editText.trim()
    if (!text) return
    await onPatch(editId, text)
    setEditId(null)
  })

  return (
    <div>
      <div className="mb-1.5 flex items-baseline gap-2">
        <h3 className="m-0 font-mono text-[11px] uppercase tracking-[0.08em] text-base-content/45">
          当日流水
        </h3>
        <span className="font-mono text-[11px] text-base-content/35">{entries.length} 条</span>
      </div>

      <form
        className="flex gap-2"
        onSubmit={e => {
          e.preventDefault()
          void submit()
        }}
      >
        <input
          className="input input-bordered w-full"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          maxLength={500}
          placeholder="刚才做了什么…如:上午改完方案 v2,下午见了客户"
          aria-label="流水内容"
        />
        <button type="submit" className="btn btn-primary" disabled={!draft.trim() || busy}>
          记录
        </button>
      </form>

      <ul className="m-0 mt-1 list-none p-0">
        {entries.map(e => {
          const editing = editId === e.id
          return (
            <li
              key={e.id}
              className="group flex items-start gap-2.5 border-b border-base-300/70 py-2 last:border-b-0"
            >
              <span className="mt-0.5 w-[42px] flex-none font-mono text-[11px] tabular-nums text-base-content/40">
                {hhmm(e.createdAt)}
              </span>
              {editing ? (
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <input
                    ref={editRef}
                    className="input input-bordered input-sm w-full"
                    value={editText}
                    maxLength={500}
                    onChange={ev => setEditText(ev.target.value)}
                    onKeyDown={ev => {
                      if (ev.key === 'Enter') void saveEdit()
                      if (ev.key === 'Escape') setEditId(null)
                    }}
                  />
                  <button type="button" className="btn btn-ghost btn-sm text-success" onClick={() => void saveEdit()} aria-label="保存">
                    ✓
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditId(null)} aria-label="取消">
                    ✕
                  </button>
                </span>
              ) : (
                <>
                  <span className="min-w-0 flex-1 break-words text-sm leading-relaxed" title={e.createdAt ? `记录于 ${new Date(e.createdAt).toLocaleString('zh-CN')}` : undefined}>
                    {e.text}
                  </span>
                  <span className="flex flex-none gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => {
                        setEditId(e.id)
                        setEditText(e.text)
                      }}
                      aria-label="编辑这条流水"
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs text-base-content/40 hover:text-secondary"
                      onClick={() => void run(() => onRemove(e.id))()}
                      aria-label="删除这条流水"
                    >
                      ✕
                    </button>
                  </span>
                </>
              )}
            </li>
          )
        })}
        {!entries.length && (
          <li className="py-3 text-center text-sm text-base-content/45">
            还没有流水。想到什么记什么,晚上 AI 汇总会一起看
          </li>
        )}
      </ul>
    </div>
  )
}
