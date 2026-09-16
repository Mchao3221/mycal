// 入参校验工具。dateKey 需通过真实历法校验(拒 2026-13-99 这类假日期)。
import type { ActivityLevel, Goal } from './types'

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

export function isValidDateKey(v: unknown): v is string {
  const s = String(v ?? '')
  if (!DATE_KEY_RE.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  )
}

export const HEALTH_KINDS = new Set(['diet', 'exercise'])
export const MEALS = new Set(['breakfast', 'lunch', 'dinner', 'snack'])
export const ACTIVITIES = new Set(['sedentary', 'light', 'moderate', 'high'])
export const GOALS = new Set(['lose', 'maintain', 'gain'])

/** kcal 归一:空→null;非法→undefined(调用方据此报 400) */
export function normKcal(v: unknown): number | null | undefined {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n)) return undefined
  const k = Math.round(n)
  return k >= 1 && k <= 20000 ? k : undefined
}

/** 体重归一:保留 0.1 kg;非法→undefined(调用方据此报 400) */
export function normWeight(v: unknown): number | undefined {
  const n = Number(v)
  if (!Number.isFinite(n)) return undefined
  const w = Math.round(n * 10) / 10
  return w >= 20 && w <= 400 ? w : undefined
}

export interface ProfilePayload {
  sex: 'male' | 'female'
  age: number
  heightCm: number
  /** v0.4 起当前体重以体重记录为单一事实源,档案可为空 */
  weightKg: number | null
  targetWeightKg: number | null
  activity: ActivityLevel
  goal: Goal
}

/** 健康档案入参归一:返回 { p } 或 { error };活动量/目标缺省 light/maintain */
export function normProfile(body: Record<string, unknown>): { p?: ProfilePayload; error?: string } {
  const b = body ?? {}
  const num = (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v))
  const age = num(b.age)
  const heightCm = num(b.heightCm)
  const weightKg = num(b.weightKg)
  const targetWeightKg = num(b.targetWeightKg)
  if (!['male', 'female'].includes(String(b.sex))) return { error: 'sex 需为 male/female' }
  if (!(Number.isFinite(age) && (age as number) >= 10 && (age as number) <= 120)) return { error: '年龄需为 10~120' }
  if (!(Number.isFinite(heightCm) && (heightCm as number) >= 80 && (heightCm as number) <= 250))
    return { error: '身高需为 80~250 cm' }
  if (weightKg !== null && !((weightKg as number) >= 20 && (weightKg as number) <= 400))
    return { error: '体重需为 20~400 kg 或留空' }
  if (targetWeightKg !== null && !((targetWeightKg as number) >= 20 && (targetWeightKg as number) <= 400))
    return { error: '目标体重需为 20~400 kg 或留空' }
  return {
    p: {
      sex: b.sex as 'male' | 'female',
      age: age as number,
      heightCm: heightCm as number,
      weightKg,
      targetWeightKg,
      activity: (ACTIVITIES.has(String(b.activity)) ? String(b.activity) : 'light') as ActivityLevel,
      goal: (GOALS.has(String(b.goal)) ? String(b.goal) : 'maintain') as Goal,
    },
  }
}
