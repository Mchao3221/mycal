import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AiSummary, HealthKind, HealthLog, HealthLogInput, MealSlot } from '../types'
import { api } from '../utils/api'
import { todayKey } from '../utils/date'

interface Props {
  dateKey: string
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

export function DiaryPanel({
  dateKey,
  logs,
  onAdd,
  onPatch,
  onRemove,
  notify,
}: Props) {
  const [kind, setKind] = useState<HealthKind>('diet')
  const [meal, setMeal] = useState<MealSlot>(defaultMeal)
  const [draft, setDraft] = useState('')
  const [kcalDraft, setKcalDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const [summary, setSummary] = useState<AiSummary | null>(null)
  const [generating, setGenerating] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editKcal, setEditKcal] = useState('')
  const editRef = useRef<HTMLInputElement>(null)

  // 切日期:拉当天已缓存的 AI 汇总,并退出行内编辑
  useEffect(() => {
    setEditId(null)
    let on = true
    api<AiSummary | null>(`/api/ai/summary/${dateKey}`)
      .then(s => on && setSummary(s))
      .catch(err => console.error('加载 AI 汇总失败:', err))
    return () => {
      on = false
    }
  }, [dateKey])

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
    // 数值变了,旧汇总保留但提示可重新生成
  }, [editId, editKcal, notify, onPatch])

  const generate = useCallback(async () => {
    if (generating) return
    if (!logs.length) {
      notify('error', '这天还没有打卡记录,先记几笔吧')
      return
    }
    setGenerating(true)
    try {
      const s = await api<AiSummary>('/api/ai/summary', {
        method: 'POST',
        body: JSON.stringify({ dateKey }),
      })
      setSummary(s)
      notify(
        'success',
        s.pendingCount
          ? `汇总完成 · ${s.pendingCount} 条未能估算热量,可手动补填`
          : '今日 AI 汇总已生成',
      )
    } catch (err) {
      notify('error', err instanceof Error ? err.message : String(err))
    } finally {
      setGenerating(false)
    }
  }, [dateKey, generating, logs.length, notify])

  const clearSummary = useCallback(async () => {
    try {
      await api<{ ok: true }>(`/api/ai/summary/${dateKey}`, { method: 'DELETE' })
      setSummary(null)
    } catch (err) {
      notify('error', err instanceof Error ? err.message : String(err))
    }
  }, [dateKey, notify])

  const renderItem = (l: HealthLog) => {
    const editing = editId === l.id
    return (
      <li key={l.id} className="flex items-center gap-2.5 border-b border-base-300 py-2.5">
        {l.kind === 'diet' && l.meal && (
          <span className="badge badge-ghost badge-sm flex-none">{MEAL_LABEL[l.meal]}</span>
        )}
        <span className="min-w-0 flex-1 truncate text-[15px]" title={l.text}>
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
            <button
              type="button"
              className="btn btn-ghost btn-xs text-success"
              onClick={() => void saveEdit()}
              aria-label="保存热量"
            >
              ✓
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={() => setEditId(null)}
              aria-label="取消编辑"
            >
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
            {l.kcal == null ? '待估' : `${l.kcalSource === 'ai' ? '≈' : ''}${l.kcal} kcal`}
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

  const netNegative = (summary?.netKcal ?? 0) <= 0

  return (
    <div>
      {/* 当日合计 + 快捷入口 */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="font-mono text-xs text-base-content/60">
          摄入 <b className="text-warning">{intakeKcal}</b> kcal
        </span>
        <span className="font-mono text-xs text-base-content/60">
          运动 <b className="text-accent">{exerciseKcal}</b> kcal
        </span>
        {missingKcal > 0 && (
          <span className="font-mono text-xs text-base-content/40">{missingKcal} 条待估</span>
        )}
      </div>

      {/* 快速录入 */}
      <form
        className="mb-4"
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
            className="input input-bordered w-24 text-right tabular-nums"
            value={kcalDraft}
            onChange={e => setKcalDraft(e.target.value)}
            inputMode="numeric"
            placeholder="kcal"
            aria-label="热量(可选)"
            title="可选;留空由 AI 汇总时估算"
          />
          <button type="submit" className="btn btn-primary px-5" disabled={!draft.trim() || busy}>
            记录
          </button>
        </div>
      </form>

      {/* 列表 */}
      <div className="mb-2 flex items-center gap-3">
        <h3 className="m-0 font-mono text-[11px] uppercase tracking-[0.08em] text-base-content/45">
          {diet.length + exercise.length === 0
            ? '还没记录'
            : `今日 ${diet.length} 饮食 · ${exercise.length} 运动`}
        </h3>
      </div>
      <ul className="m-0 max-h-[260px] list-none overflow-y-auto p-0 pr-1">
        {[...diet, ...exercise].map(renderItem)}
        {logs.length === 0 && (
          <li className="py-4 text-center text-sm text-base-content/50">
            上方记一笔今天的吃动,再点「生成今日汇总」
          </li>
        )}
      </ul>

      {/* AI 汇总 */}
      <div className="mt-5 rounded-xl border border-base-300 bg-base-200/50 p-4">
        {generating ? (
          <div className="flex items-center gap-3 py-2 text-sm text-base-content/60">
            <span className="loading loading-spinner loading-sm" />
            AI 正在估算热量并结合档案点评…
          </div>
        ) : summary ? (
          <>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              <div>
                <div className="font-mono text-[11px] text-base-content/45">摄入</div>
                <div className="font-display text-xl font-semibold tabular-nums text-warning">
                  {summary.intakeKcal}
                  <small className="ml-0.5 text-xs font-normal text-base-content/45">kcal</small>
                </div>
              </div>
              <div>
                <div className="font-mono text-[11px] text-base-content/45">总消耗</div>
                <div className="font-display text-xl font-semibold tabular-nums text-accent">
                  {summary.burnKcal}
                  <small className="ml-0.5 text-xs font-normal text-base-content/45">kcal</small>
                </div>
                <div className="font-mono text-[10px] text-base-content/40">
                  BMR {summary.bmr} · TDEE {summary.tdee} · 运动 {summary.exerciseKcal}
                </div>
              </div>
              <div>
                <div className="font-mono text-[11px] text-base-content/45">净差</div>
                <div
                  className={`font-display text-xl font-semibold tabular-nums ${
                    netNegative ? 'text-success' : 'text-error'
                  }`}
                >
                  {summary.netKcal > 0 ? '+' : ''}
                  {summary.netKcal}
                  <small className="ml-0.5 text-xs font-normal text-base-content/45">kcal</small>
                </div>
                <div className="font-mono text-[10px] text-base-content/40">
                  {netNegative ? '亏空' : '盈余'} ≈ {(summary.weightDeltaKg * 7).toFixed(2)} kg/周
                </div>
              </div>
              <div>
                <div className="font-mono text-[11px] text-base-content/45">建议摄入</div>
                <div className="font-display text-xl font-semibold tabular-nums">
                  {summary.targetKcal}
                  <small className="ml-0.5 text-xs font-normal text-base-content/45">kcal</small>
                </div>
              </div>
            </div>

            {summary.pendingCount > 0 && (
              <p className="mb-0 mt-3 font-mono text-xs text-warning">
                ⚠ {summary.pendingCount} 条未能估算热量,已按 0 计,可点击条目手动补填后重新生成
              </p>
            )}

            <p className="mb-0 mt-3 text-sm leading-relaxed whitespace-pre-line">
              {summary.comment}
            </p>
            <div className="mt-3 flex items-center gap-2 border-t border-base-300 pt-2.5">
              <span className="mr-auto font-mono text-[11px] text-base-content/40">
                {summary.model} ·{' '}
                {new Date(summary.generatedAt).toLocaleString('zh-CN', {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {dateKey === todayKey() ? '' : ' · 历史日'}
              </span>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => void clearSummary()}>
                清除
              </button>
              <button type="button" className="btn btn-outline btn-xs" onClick={() => void generate()}>
                重新生成
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="m-0 flex-1 text-sm text-base-content/55">
              记完后点右侧按钮:AI 会补齐未填的热量,并结合你的档案(基础代谢/日常消耗)给出今日收支点评。
            </p>
            <button type="button" className="btn btn-accent btn-sm" onClick={() => void generate()}>
              ✨ 生成今日汇总
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
