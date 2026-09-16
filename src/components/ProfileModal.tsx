import { useEffect, useState } from 'react'
import type { ActivityLevel, Goal, Profile } from '../types'
import { api } from '../utils/api'

interface Props {
  open: boolean
  onClose: () => void
  notify: (kind: 'success' | 'error', text: string) => void
}

const ACTIVITIES: { value: ActivityLevel; label: string }[] = [
  { value: 'sedentary', label: '久坐少动(基本不运动)' },
  { value: 'light', label: '轻度活动(每周 1~3 次)' },
  { value: 'moderate', label: '中度活动(每周 3~5 次)' },
  { value: 'high', label: '高强度(每周 6~7 次)' },
]

const GOALS: { value: Goal; label: string }[] = [
  { value: 'lose', label: '减脂' },
  { value: 'maintain', label: '保持' },
  { value: 'gain', label: '增肌' },
]

interface FormState {
  sex: 'male' | 'female'
  age: string
  heightCm: string
  targetWeightKg: string
  activity: ActivityLevel
  goal: Goal
}

const EMPTY: FormState = {
  sex: 'male',
  age: '',
  heightCm: '',
  targetWeightKg: '',
  activity: 'light',
  goal: 'maintain',
}

/**
 * 健康档案:AI 汇总结合这里的数据算 BMR/TDEE 并点评。
 * v0.4 起"当前体重"以体重记录为单一事实源(档案接口自动推导回填),此处不再手动填。
 */
export function ProfileModal({ open, onClose, notify }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY)
  const [derivedWeight, setDerivedWeight] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  // 打开时拉取现有档案
  useEffect(() => {
    if (!open) return
    api<Profile | null>('/api/profile')
      .then(p => {
        if (p) {
          setForm({
            sex: p.sex,
            age: String(p.age),
            heightCm: String(p.heightCm),
            targetWeightKg: p.targetWeightKg == null ? '' : String(p.targetWeightKg),
            activity: p.activity,
            goal: p.goal,
          })
          setDerivedWeight(p.weightKg)
        }
      })
      .catch(err => notify('error', `加载档案失败:${err instanceof Error ? err.message : err}`))
      .finally(() => setLoaded(true))
  }, [open, notify])

  if (!open) return null

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  const submit = async () => {
    if (saving) return
    setSaving(true)
    try {
      await api<Profile>('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({
          sex: form.sex,
          age: form.age,
          heightCm: form.heightCm,
          targetWeightKg: form.targetWeightKg,
          activity: form.activity,
          goal: form.goal,
        }),
      })
      notify('success', '健康档案已保存')
      onClose()
    } catch (err) {
      notify('error', err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const field = 'input input-bordered w-full text-right tabular-nums'

  return (
    <div className="modal modal-open" role="dialog" aria-modal="true" aria-label="健康档案">
      <div className="modal-box">
        <h3 className="text-lg font-semibold">健康档案</h3>
        <p className="mt-1 text-sm text-base-content/55">
          仅存本库(已上锁)。AI 汇总会用 Mifflin-St Jeor 公式按档案估算基础代谢与日常消耗,
          体重取你的最新一条体重记录。
        </p>

        {!loaded ? (
          <div className="py-8 text-center">
            <span className="loading loading-spinner loading-md" />
          </div>
        ) : (
          <form
            className="mt-4 space-y-3"
            onSubmit={e => {
              e.preventDefault()
              void submit()
            }}
          >
            <div className="flex gap-2">
              <button
                type="button"
                className={`btn btn-sm flex-1 ${form.sex === 'male' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => set('sex', 'male')}
              >
                男
              </button>
              <button
                type="button"
                className={`btn btn-sm flex-1 ${form.sex === 'female' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => set('sex', 'female')}
              >
                女
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="form-control">
                <span className="label-text mb-1 text-xs text-base-content/55">年龄(岁)</span>
                <input
                  className={field}
                  value={form.age}
                  onChange={e => set('age', e.target.value)}
                  inputMode="numeric"
                  placeholder="28"
                />
              </label>
              <label className="form-control">
                <span className="label-text mb-1 text-xs text-base-content/55">身高(cm)</span>
                <input
                  className={field}
                  value={form.heightCm}
                  onChange={e => set('heightCm', e.target.value)}
                  inputMode="decimal"
                  placeholder="175"
                />
              </label>
            </div>
            <div className="rounded-xl bg-base-200/60 px-4 py-2.5 font-mono text-xs text-base-content/60">
              当前体重
              <b className="ml-2 text-sm tabular-nums text-base-content">
                {derivedWeight != null ? `${derivedWeight.toFixed(1)} kg` : '未记录'}
              </b>
              <span className="ml-2 text-base-content/45">以体重记录为准,在右栏「体重」块录入</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="form-control">
                <span className="label-text mb-1 text-xs text-base-content/55">目标体重(kg,可选)</span>
                <input
                  className={field}
                  value={form.targetWeightKg}
                  onChange={e => set('targetWeightKg', e.target.value)}
                  inputMode="decimal"
                  placeholder="65"
                />
              </label>
              <label className="form-control">
                <span className="label-text mb-1 text-xs text-base-content/55">目标方向</span>
                <select
                  className="select select-bordered w-full"
                  value={form.goal}
                  onChange={e => set('goal', e.target.value as Goal)}
                >
                  {GOALS.map(g => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="form-control">
              <span className="label-text mb-1 text-xs text-base-content/55">
                日常活动量(不含刻意运动,运动打卡单独计)
              </span>
              <select
                className="select select-bordered w-full"
                value={form.activity}
                onChange={e => set('activity', e.target.value as ActivityLevel)}
              >
                {ACTIVITIES.map(a => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="modal-action">
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
                取消
              </button>
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={saving || !form.age || !form.heightCm}
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </form>
        )}
      </div>
      <button className="modal-backdrop" onClick={onClose} aria-label="关闭" />
    </div>
  )
}
