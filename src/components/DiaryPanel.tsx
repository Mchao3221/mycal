import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HealthKind, HealthLog, HealthLogInput, MealSlot } from '../types'

interface Props {
  logs: HealthLog[]
  onAdd: (input: HealthLogInput) => Promise<void>
  onPatch: (id: string, patch: Partial<HealthLogInput>) => Promise<void>
  onRemove: (id: string) => Promise<void>
  notify: (kind: 'success' | 'error', text: string) => void
}

const MEAL_LABEL: Record<MealSlot, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
}

/** 按当前时间猜一个默认餐次 */
function defaultMeal(): MealSlot {
  const h = new Date().getHours() + new Date().getMinutes() / 60
  if (h < 10.5) return 'breakfast'
  if (h < 15) return 'lunch'
  if (h < 21) return 'dinner'
  return 'snack'
}

const kcalOf = (l: HealthLog) => l.kcal ?? 0

/** 吃动打卡:饮食/运动条目快记 + 行内热量修正(AI 估算在右侧汇总面板) */
export function DiaryPanel({ logs, onAdd, onPatch, onRemove, notify }: Props) {
  const [kind, setKind] = useState<HealthKind>('diet')
  const [meal, setMeal] = useState<MealSlot>(defaultMeal)
  const [draft, setDraft] = useState('')
  const [kcalDraft, setKcalDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editKcal, setEditKcal] = useState('')
  const editRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editId) editRef.current?.focus()
  }, [editId])

  const [diet, exercise] = useMemo(
    () => [logs.filter(l => l.kind === 'diet'), logs.filter(l => l.kind === 'exercise')],
    [logs],
  )
  const intakeKcal = diet.reduce((s, l) => s + kcalOf(l), 0)
  const exerciseKcal = exercise.reduce((s, l) => s + kcalOf(l), 0)
  const missingKcal = logs.filter(l => l.kcal == null).length

  const submit = async () => {
    const text = draft.trim()
    if (!text || busy) return
    let kcal: number | null = null
    if (kcalDraft.trim()) {
      const n = Math.round(Number(kcalDraft))
      if (!Number.isFinite(n) || n < 1 || n > 20000) {
        notify('error', '热量需为 1~20000 的数字,或留空交给 AI 估算')
        return
      }
      kcal = n
    }
    setBusy(true)
    try {
      await onAdd({ kind, text, meal: kind === 'diet' ? meal : null, kcal })
      setDraft('')
      setKcalDraft('')
    } catch (err) {
      notify('error', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (l: HealthLog) => {
    setEditId(l.id)
    setEditKcal(l.kcal == null ? '' : String(l.kcal))
  }

  const saveEdit = useCallback(async () => {
    if (!editId) return
    const id = editId
    const raw = editKcal.trim()
    if (raw) {
      const n = Math.round(Number(raw))
      if (!Number.isFinite(n) || n < 1 || n > 20000) {
        notify('error', '热量需为 1~20000 的数字,留空表示清除')
        return
      }
      await onPatch(id, { kcal: n })
    } else {
      await onPatch(id, { kcal: null })
    }
    setEditId(null)
    // 数值变了,旧汇总保留,右侧面板可「重新生成」
  }, [editId, editKcal, notify, onPatch])

  const renderItem = (l: HealthLog) => {
    const editing = editId === l.id
    return (
      <li key={l.id} className="flex items-center gap-2 border-b border-base-300 py-2 last:border-b-0">
        {l.kind === 'diet' && l.meal && (
          <span className="badge badge-ghost badge-sm flex-none">{MEAL_LABEL[l.meal]}</span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm" title={l.text}>
          {l.text}
        </span>
        {editing ? (
          <span className="flex flex-none items-center gap-1">
            <input
              ref={editRef}
              className="input input-bordered input-xs w-20 text-right tabular-nums"
              value={editKcal}
              inputMode="numeric"
              placeholder="kcal"
              onChange={e => setEditKcal(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') void saveEdit()
                if (e.key === 'Escape') setEditId(null)
              }}
            />
            <button type="button" className="btn btn-ghost btn-xs text-success" onClick={() => void saveEdit()} aria-label="保存热量">
              ✓
            </button>
            <button type="button" className="btn btn-ghost btn-xs" onClick={() => setEditId(null)} aria-label="取消编辑">
              ✕
            </button>
          </span>
        ) : (
          <button
            type="button"
            className={`btn btn-ghost btn-xs flex-none font-mono tabular-nums ${
              l.kcal == null ? 'text-base-content/35' : l.kcalSource === 'ai' ? 'text-accent/80' : 'text-base-content/70'
            }`}
            onClick={() => startEdit(l)}
            title={
              l.kcal == null
                ? '待估算,点击手动填写'
                : l.kcalSource === 'ai'
                  ? 'AI 估算值,点击修正'
                  : '手动值,点击修改(清空=恢复待估)'
            }
          >
            {l.kcal == null ? '待估' : `${l.kcalSource === 'ai' ? '≈' : ''}${l.kcal}`}
          </button>
        )}
        <button
          type="button"
          className="grid size-[26px] flex-none place-items-center rounded-md text-base-content/30 transition-colors hover:bg-secondary/10 hover:text-secondary"
          onClick={() => void onRemove(l.id).catch(err => notify('error', String(err)))}
          aria-label={`删除:${l.text}`}
        >
          ✕
        </button>
      </li>
    )
  }

  return (
    <div>
      {/* 当日合计 */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-xs text-base-content/60">
        <span>
          摄入 <b className="text-warning">{intakeKcal}</b> kcal
        </span>
        <span>
          运动 <b className="text-accent">{exerciseKcal}</b> kcal
        </span>
        {missingKcal > 0 && <span className="text-base-content/40">{missingKcal} 条待估</span>}
        <span className="ml-auto text-base-content/40">
          {diet.length + exercise.length === 0 ? '还没记录' : `${diet.length} 饮食 · ${exercise.length} 运动`}
        </span>
      </div>

      {/* 快速录入 */}
      <form
        className="mb-3"
        onSubmit={e => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="mb-2 flex items-center gap-1.5">
          <button
            type="button"
            className={`btn btn-sm ${kind === 'diet' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setKind('diet')}
          >
            🍽 饮食
          </button>
          <button
            type="button"
            className={`btn btn-sm ${kind === 'exercise' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setKind('exercise')}
          >
            🏃 运动
          </button>
          {kind === 'diet' && (
            <select
              className="select select-bordered select-sm w-24"
              value={meal}
              onChange={e => setMeal(e.target.value as MealSlot)}
              aria-label="餐次"
            >
              {(Object.keys(MEAL_LABEL) as MealSlot[]).map(m => (
                <option key={m} value={m}>
                  {MEAL_LABEL[m]}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex gap-2">
          <input
            className="input input-bordered w-full"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={kind === 'diet' ? '吃了什么…如:一碗牛肉面' : '做了什么…如:慢跑 30 分钟'}
            aria-label="打卡内容"
          />
          <input
            className="input input-bordered w-20 text-right tabular-nums"
            value={kcalDraft}
            onChange={e => setKcalDraft(e.target.value)}
            inputMode="numeric"
            placeholder="kcal"
            aria-label="热量(可选)"
            title="可选;留空由 AI 汇总时估算"
          />
          <button type="submit" className="btn btn-primary px-4" disabled={!draft.trim() || busy}>
            记录
          </button>
        </div>
      </form>

      <ul className="m-0 list-none p-0">
        {[...diet, ...exercise].map(renderItem)}
        {logs.length === 0 && (
          <li className="py-3 text-center text-sm text-base-content/45">
            还没记吃动;右侧「AI 汇总」连流水一起看,只记流水也能生成
          </li>
        )}
      </ul>
    </div>
  )
}
