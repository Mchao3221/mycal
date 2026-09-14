/** 与前端 src/types.ts 保持一致的条目结构 */
export interface Todo {
  id: string
  text: string
  done: boolean
  createdAt: number
  /** 由 .ics 订阅导入的日程 */
  source?: 'ics'
  /** ICS 事件 UID,用于重复导入去重 */
  uid?: string
}

/** 全量存储结构:日期 key(YYYY-MM-DD) -> 当天条目 */
export type TodoStore = Record<string, Todo[]>

export interface TodoRow {
  id: string
  date_key: string
  text: string
  done: number
  created_at: number
  source: string | null
  uid: string | null
}

// ---------- 打卡日记 ----------

export type HealthKind = 'diet' | 'exercise'
export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export interface HealthLog {
  id: string
  kind: HealthKind
  text: string
  meal?: MealSlot
  /** 千卡;null = 待 AI 估算 */
  kcal: number | null
  /** kcal 非空时有值 */
  kcalSource?: 'ai' | 'manual'
  createdAt: number
}

export interface HealthLogInput {
  kind: HealthKind
  text: string
  meal?: MealSlot | null
  kcal?: number | null
}

export type HealthStore = Record<string, HealthLog[]>

export interface HealthLogRow {
  id: string
  date_key: string
  kind: string
  text: string
  meal: string | null
  kcal: number | null
  kcal_source: string | null
  created_at: number
}

// ---------- 健康档案 ----------

export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'high'
export type Goal = 'lose' | 'maintain' | 'gain'

export interface Profile {
  sex: 'male' | 'female'
  age: number
  heightCm: number
  weightKg: number
  targetWeightKg: number | null
  activity: ActivityLevel
  goal: Goal
  updatedAt: number
}

export interface ProfileRow {
  sex: string | null
  age: number | null
  height_cm: number | null
  weight_kg: number | null
  target_weight_kg: number | null
  activity: string | null
  goal: string | null
  updated_at: number | null
}

// ---------- AI 每日汇总 ----------

export interface AiSummary {
  dateKey: string
  generatedAt: number
  model: string
  /** 摄入合计 */
  intakeKcal: number
  /** 运动消耗合计 */
  exerciseKcal: number
  bmr: number
  tdee: number
  /** 结合目标的建议摄入 */
  targetKcal: number
  /** 总消耗 = TDEE + 运动 */
  burnKcal: number
  /** 净差 = 摄入 - 总消耗,负数为亏空 */
  netKcal: number
  /** 净差折算体重(≈7700 kcal/kg),负=掉秤 */
  weightDeltaKg: number
  /** AI 也没估出热量的条数 */
  pendingCount: number
  comment: string
}
